// Tailwind v4 CSS-first pipeline. Contrary to the Wave-2 (plan 01-02)
// assumption, Turbopack in Next.js 16.2.10 does NOT process globals.css's
// `@import "tailwindcss"` / `@plugin "daisyui"` directives without this
// explicit PostCSS plugin — without it the raw directives are served
// untransformed and the page renders unstyled (found at the plan 01-03
// browser-verification checkpoint).
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
