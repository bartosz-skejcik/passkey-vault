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
