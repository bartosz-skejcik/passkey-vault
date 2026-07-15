// Tailwind v4 CSS-first pipeline (WXT/Vite auto-detects this project-root
// postcss config). Identical to web/postcss.config.mjs's own rationale:
// without this explicit PostCSS plugin, `style.css`'s `@import "tailwindcss"`
// / `@plugin "daisyui"` directives are served untransformed and the popup
// renders unstyled.
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
