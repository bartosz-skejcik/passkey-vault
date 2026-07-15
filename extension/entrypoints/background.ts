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
  main() {
    console.log('[passkey-vault] background context started');

    browser.runtime.onMessage.addListener((message: unknown) => {
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
