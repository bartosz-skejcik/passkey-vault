// types/css-inline.d.ts -- ambient module declaration for Vite's `?inline`
// CSS import suffix (plan 11-08, Task 1). Vite's own `vite/client` types
// (referenced transitively via wxt's generated `.wxt/wxt.d.ts` ->
// `wxt/vite-builder-env` -> `/// <reference types="vite/client" />`)
// declare `*.css` as an EMPTY module (no default export) -- correct for the
// side-effecting default CSS import, but useless for `?inline`, which asks
// Vite to return the fully processed CSS as a plain string instead of
// injecting a `<style>` tag. TypeScript's ambient-module wildcard matching
// is a literal suffix match on the import specifier, so `'*.css'` does NOT
// match `'pv-ui/tokens.css?inline'` (it doesn't end in the literal `.css`
// substring) -- this file adds the missing declaration for that exact
// suffix pattern, scoped narrowly so it never weakens the plain `*.css`
// side-effect-import typing used elsewhere (e.g. popup/style.css).
declare module "*.css?inline" {
  const css: string;
  export default css;
}
