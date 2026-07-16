// Standalone password-strength heuristic — created ahead of the full
// generator (a later plan) because RegisterForm's inline strength meter
// (UI-SPEC's locked requirement) needs it now. The later generator plan
// reuses this file rather than recreating it.
export type Strength = "weak" | "medium" | "strong";

function countCharacterClasses(password: string): number {
  let classes = 0;
  if (/[a-z]/.test(password)) classes++;
  if (/[A-Z]/.test(password)) classes++;
  if (/[0-9]/.test(password)) classes++;
  if (/[^a-zA-Z0-9]/.test(password)) classes++;
  return classes;
}

export function scorePasswordStrength(password: string): Strength {
  const length = password.length;
  const classes = countCharacterClasses(password);

  if (length < 8) return "weak";
  if (classes <= 1) return "weak";
  if (length >= 16 && classes >= 3) return "strong";
  if (length >= 12 && classes >= 2) return "medium";
  if (length >= 8 && classes >= 3) return "medium";
  return "weak";
}

export type MeterColor = "error" | "warning" | "success";

// Progress-bar variant of the heuristic: color = character-class mix
// (letters only → error, +digits → warning, +specials → success), width =
// how far the password fills its tier's cap (letters-only can never pass
// 1/3 of the bar, letters+digits 2/3, full mix up to 100%). Length
// saturates at METER_FULL_LENGTH characters within the tier.
const METER_FULL_LENGTH = 12;

export function scorePasswordMeter(password: string): { percent: number; color: MeterColor } {
  if (password.length === 0) {
    return { percent: 0, color: "error" };
  }

  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);

  const tiers = 1 + (hasDigit ? 1 : 0) + (hasSpecial ? 1 : 0);
  const color: MeterColor = tiers === 3 ? "success" : tiers === 2 ? "warning" : "error";
  const cap = (tiers / 3) * 100;
  const lengthFactor = Math.min(1, password.length / METER_FULL_LENGTH);

  return { percent: Math.round(cap * lengthFactor), color };
}
