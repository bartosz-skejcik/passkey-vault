// Compose/normalize helpers for IdentityFields' structured address (Bartek
// live-review round 4, TASK 6) — the single source of truth for turning
// {addressLine1, addressLine2, city, state, zip, country} into (a) the
// legacy flat `address` string the extension's autofill still reads/writes
// (extension/lib/vault/types.ts's own IdentityFields.address, filled via a
// single `street-address`-style input — see extension/lib/autofill/
// fill-dom.ts's `write(targets.address, values.address)` and
// extension/entrypoints/background/autofill-match.ts's `address:
// item.fields.address`, both READ-ONLY references that this module does
// not touch), and (b) DetailPanel's stacked-line display.
import type { IdentityFields } from "./types";

type StructuredAddress = Pick<
  IdentityFields,
  "addressLine1" | "addressLine2" | "city" | "state" | "zip" | "country"
>;

/** Non-empty structured address parts, in display/compose order. Empty/
 * whitespace-only parts are dropped entirely (per Bartek's spec: "omit
 * empty lines"). */
export function addressLines(fields: StructuredAddress): string[] {
  return [fields.addressLine1, fields.addressLine2, fields.city, fields.state, fields.zip, fields.country]
    .map((v) => (v ?? "").trim())
    .filter((v) => v !== "");
}

/** Composes the legacy flat `address` string from structured parts. The
 * extension's autofill only ever reads/writes ONE input for `address`, so a
 * single comma-joined line is what actually fills sanely into that field —
 * unlike the newline-joined multi-line block DetailPanel renders for
 * on-screen display. Returns "" when every structured part is empty. */
export function composeLegacyAddress(fields: StructuredAddress): string {
  return addressLines(fields).join(", ");
}
