// Plan 08-02: the onMessage listener below is the message-relay + storage-
// injection wiring point (D-04) — all actual derive/wrap/unwrap/storage
// logic lives in ../lib/crypto/vault-session.ts and ./wasm-loader.ts, never
// here. `type: 'module'` was declared from plan 08-01's first commit
// onward because MV3 service workers only support `import` syntax when the
// manifest's background field is a module.
//
// `main()` must stay synchronous with no top-level `await`: WXT imports
// this file under Node during the build step, so async/browser-only side
// effects placed outside `main()` would break the build, not just the
// runtime. Registering the listener itself is synchronous; only the
// listener's own callback body is async.
import { browser } from 'wxt/browser';
import { roundTripSpike } from '../lib/crypto/vault-session';
import { registerMessageRouter } from './background/router';
import { registerAutoLockAlarmListener, armAutoLock } from './background/autolock';
import { ensureHydrated } from './background/vault-session';
import { readSessionMeta } from './background/session-storage';
import { ensureVaultSyncStarted } from './background/vault-store';

export default defineBackground({
  type: 'module',
  // D-08: WXT only emits `background.persistent` into the generated MV2
  // manifest when this option is set explicitly on the entrypoint itself
  // (wxt.config.ts has no equivalent knob — see manifest.mjs's
  // `background.options.persistent` read). Without it, Firefox's MV2
  // manifest.background omits `persistent` entirely (undefined keys are
  // dropped by JSON.stringify), leaving the deliberate persistent-background
  // pin implicit rather than the explicit, generated-output proof plan
  // 08-03 requires (SC #4). Ignored on Chrome MV3 and Firefox MV3, where
  // WXT never reads this field.
  persistent: true,
  main() {
    console.log('[passkey-vault] background context started');

    // Plan 09-02: the real session router (session.status/
    // session.setAutoLockMinutes this wave; unlock.*/auth.*/vault.* in
    // 09-03/09-04/09-05, see router.ts) and the chrome.alarms auto-lock
    // listener. Both must be registered synchronously at startup — an
    // MV3 service worker that misses registering its onMessage/onAlarm
    // listeners on a given wake will silently drop messages/alarms fired
    // during that wake window. This is a SEPARATE onMessage listener from
    // the spike.roundtrip one below (WebExtensions supports multiple
    // listeners; each independently decides whether to handle a given
    // message) — router.ts enforces its own copy of the WR-01
    // sender-validation gate, so it stays secure regardless of whether
    // this file's other listener exists.
    registerMessageRouter();
    registerAutoLockAlarmListener();

    // T-09-07: defensively re-arm the auto-lock alarm whenever a mid-
    // session SW restart finds the vault still logically unlocked — the
    // key envelope and the alarm are independent platform primitives
    // (09-RESEARCH.md Pattern 3), so losing the alarm without losing the
    // envelope is a real, if rare, failure mode this guards against.
    // Usually a no-op: chrome.storage.session itself clears on a genuine
    // browser restart, so ensureHydrated() only finds something to
    // re-arm here after e.g. a service-worker crash/reload mid-session.
    // Fire-and-forget IIFE, not a top-level await (see this file's own
    // header comment on why main() must stay synchronous).
    //
    // Post-UAT fix: this is also the ONLY place a fresh-but-already-
    // unlocked wake is ever detected (ensureHydrated() returning non-null
    // here IS that signal) — vault-store.ts's own lock-state subscription
    // only reacts to a lock->unlock TRANSITION, which never fires on this
    // path. Without ensureVaultSyncStarted() here, sync/the initial pull
    // never start and the popup shows an empty vault indefinitely (found
    // by the real-browser Phase 9 UAT). ensureVaultSyncStarted() is
    // idempotent, so calling it here is safe even if a real transition
    // also fires around the same time.
    void (async () => {
      const uk = await ensureHydrated();
      if (uk === null) {
        return;
      }
      ensureVaultSyncStarted();
      const meta = await readSessionMeta();
      if (meta !== null) {
        await armAutoLock(meta.idleTimeoutMinutes);
      }
    })();

    browser.runtime.onMessage.addListener((message: unknown, sender) => {
      // WR-01: only this extension's own pages (popup/options — whether
      // action-hosted or opened in a tab) may trigger crypto work. The
      // discriminator is the browser-constructed sender.url origin: our own
      // chrome-extension://<id>/ pages pass; content scripts report the
      // hostile page's http(s) URL and foreign extensions a different id,
      // so both are rejected. (A bare `sender.tab !== undefined` check is
      // WRONG here — it would also reject our own pages opened in a tab,
      // caught by the real-browser UAT.) Phase 10 must widen this into an
      // explicit allow-list when content scripts legitimately need the
      // background, never by deleting the check.
      const ownOrigin = browser.runtime.getURL('');
      if (sender.id !== browser.runtime.id || !sender.url?.startsWith(ownOrigin)) {
        return undefined;
      }

      const isSpikeRoundtrip =
        typeof message === 'object' &&
        message !== null &&
        (message as { kind?: unknown }).kind === 'spike.roundtrip';

      if (!isSpikeRoundtrip) {
        return undefined;
      }

      return roundTripSpike(browser.storage.session).catch((e: unknown) => ({
        survived: false,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }));
    });
  },
});
