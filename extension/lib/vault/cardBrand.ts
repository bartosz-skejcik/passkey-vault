// Pure card-brand detection from a (possibly partial/formatted) card
// number — no network lookup, no external BIN database, just the public
// IIN/BIN prefix ranges. Verbatim port of web/src/lib/vault/cardBrand.ts
// for the popup UI round's ItemIconTile (Bartek-decided, FINAL) — kept
// byte-identical to the web original so the two never drift. Zero-
// knowledge note: this only ever runs client-side over an already-
// decrypted number; nothing here is sent anywhere.
export type CardBrand = "visa" | "mastercard" | "amex" | "discover";

export function detectCardBrand(number: string): CardBrand | null {
  const digits = number.replace(/\D/g, "");
  if (digits === "") return null;

  if (digits.startsWith("4")) return "visa";

  const twoDigit = Number(digits.slice(0, 2));
  const fourDigit = Number(digits.slice(0, 4));
  if ((twoDigit >= 51 && twoDigit <= 55) || (fourDigit >= 2221 && fourDigit <= 2720)) {
    return "mastercard";
  }

  if (digits.startsWith("34") || digits.startsWith("37")) return "amex";

  const threeDigit = Number(digits.slice(0, 3));
  if (digits.startsWith("6011") || digits.startsWith("65") || (threeDigit >= 644 && threeDigit <= 649)) {
    return "discover";
  }

  return null;
}
