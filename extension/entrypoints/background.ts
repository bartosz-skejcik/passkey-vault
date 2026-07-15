// The extension's background entry point. All actual derive/wrap/unwrap/
// storage logic lives in ./background/*.ts (session core, router, autolock,
// sync), never here — this file only registers listeners and runs the
// fresh-wake path. `type: 'module'` was declared from plan 08-01's first
// commit onward because MV3 service workers only support `import` syntax
// when the manifest's background field is a module.
//
// WR-08 (09-REVIEW.md): Phase 8's `spike.roundtrip` debug listener and its
// hard-coded-password Argon2 path (lib/crypto/vault-session.ts) are DELETED
// here. That file's own header said it backed the throwaway debug popup
// "until Plan 09-05 replaces the popup entirely" — 09-06 did replace it
// (popup/main.ts was deleted) and nothing sent `spike.roundtrip` any more,
// yet the listener still shipped to users, able to run a full Argon2id
// derivation under a hard-coded credential on demand.
//
// `main()` must stay synchronous with no top-level `await`: WXT imports
// this file under Node during the build step, so async/browser-only side
// effects placed outside `main()` would break the build, not just the
// runtime. Registering the listener itself is synchronous; only the
// listener's own callback body is async.
import { registerMessageRouter, registerAutofillFrameChannel } from './background/router';
import { registerAutoLockAlarmListener, armAutoLock } from './background/autolock';
import { ensureHydrated } from './background/vault-session';
import { readSessionMeta } from './background/session-storage';
import { ensureVaultSyncStarted } from './background/vault-store';
import { registerSyncPollAlarmListener } from './background/sync-client';

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
    // during that wake window. router.ts enforces its own copy of the
    // WR-01 sender-validation gate, so it stays secure independently of
    // what other listeners exist.
    registerMessageRouter();
    // Plan 10-09: the content-relay <-> background channel (a SEPARATE
    // listener from registerMessageRouter() above, see router.ts's own
    // header comment for why) -- registered synchronously here for the same
    // reason as every other listener in this function: an MV3 service
    // worker that misses registering onMessage on a given wake silently
    // drops messages fired during that wake window.
    registerAutofillFrameChannel();
    registerAutoLockAlarmListener();
    // WR-06: the sync poll fallback is alarm-backed (a setInterval does not
    // survive an MV3 idle-kill, which is precisely the WS-stripped-proxy
    // scenario the fallback exists for). Registered synchronously here for
    // the same reason as the two above.
    registerSyncPollAlarmListener();

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

  },
});
