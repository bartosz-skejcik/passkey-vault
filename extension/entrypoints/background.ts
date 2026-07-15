// Phase 8 bootstrap stub. Plan 08-02 replaces this `main()` body with the
// `pv_wasm.js` glue import + explicit-path `init()` call; `type: 'module'`
// is declared from this first commit onward because MV3 service workers
// only support `import` syntax when the manifest's background field is a
// module, and retrofitting that later would require touching the manifest
// config again.
//
// `main()` must stay synchronous with no top-level `await`: WXT imports
// this file under Node during the build step, so async/browser-only side
// effects placed outside `main()` would break the build, not just the
// runtime.
export default defineBackground({
  type: 'module',
  main() {
    console.log('[passkey-vault] background context started');
  },
});
