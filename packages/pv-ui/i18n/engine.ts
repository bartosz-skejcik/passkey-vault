// pv-ui/i18n/engine.ts — the shared i18n resolver (DS-02, plan 16-04).
// Extracted from web/src/lib/i18n/dictionary.ts and
// extension/lib/i18n/dictionary.ts, which both closed over their own
// module-scoped `DICTIONARY` constant with a non-generic
// `t(locale, key)`. This module makes the lookup itself generic
// (`t<D>(dict, locale, key)`) so both consumers can keep their own
// surface-scoped `keyof` narrowing via a thin per-consumer wrapper
// (`return tEngine(DICTIONARY, locale, key);`), with zero call-site churn
// at either surface's ~13-16 `t(locale, key)` call sites.
export type Locale = "pl" | "en";

/**
 * Generic dictionary lookup — the one piece of genuinely new logic this
 * extraction introduces (today's per-file `t()` is NOT generic; it closes
 * over one hardcoded `DICTIONARY` constant). Each consumer's own thin
 * wrapper preserves its own `keyof typeof DICTIONARY` compile-time
 * narrowing (T-16-07) by calling this with its own dict type as `D`.
 */
export function t<D extends Record<string, Record<Locale, string>>>(
  dict: D,
  locale: Locale,
  key: keyof D,
): string {
  return dict[key][locale];
}

/**
 * Substitutes `{token}` placeholders in a translated string with the
 * given values. Falls back to appending the values (space-joined) when no
 * placeholder token is found in the template — this keeps components
 * correct under both the real dictionary (which contains the `{token}`
 * markers) and test doubles that stub `t()` as an identity function
 * returning the bare key (which obviously has no placeholder to replace).
 *
 * Moved byte-for-byte from web/src/lib/i18n/dictionary.ts:736-751.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  let result = template;
  let replacedAny = false;
  for (const [key, value] of Object.entries(vars)) {
    const token = `{${key}}`;
    if (result.includes(token)) {
      result = result.split(token).join(value);
      replacedAny = true;
    }
  }
  if (!replacedAny) {
    const extra = Object.values(vars).join(" ");
    result = extra ? `${result} ${extra}` : result;
  }
  return result;
}

/**
 * One-shot locale detection. `navigator` is always defined in a real DOM
 * document (web app, popup); the `typeof`-guard only matters for this
 * module being importable from a Node-environment vitest run (background
 * tests) without crashing.
 *
 * Moved byte-for-byte from extension/lib/i18n/dictionary.ts:296-301.
 */
export function resolveLocale(): Locale {
  if (typeof navigator === "undefined") {
    return "en";
  }
  return navigator.language.toLowerCase().startsWith("pl") ? "pl" : "en";
}
