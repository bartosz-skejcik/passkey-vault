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
