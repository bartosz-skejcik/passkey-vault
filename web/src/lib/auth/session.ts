// localStorage-backed session/account storage. The session token is an
// auth credential (not vault-secret material) — ordinary localStorage is
// the CONTEXT.md-locked choice for v0.1 (httpOnly-cookie hardening is
// explicitly deferred pre-v1.0, not implemented here). Same defensive
// try/catch shape as Sidebar.tsx's theme persistence.
const SESSION_TOKEN_KEY = "pv-session-token";
const ACCOUNT_EMAIL_KEY = "pv-account-email";

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string): void {
  try {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    // localStorage may be unavailable (private mode) — session still
    // works for this in-memory page load, just won't survive reload.
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // see setSessionToken
  }
}

export function getStoredEmail(): string | null {
  try {
    return localStorage.getItem(ACCOUNT_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function setStoredEmail(email: string): void {
  try {
    localStorage.setItem(ACCOUNT_EMAIL_KEY, email);
  } catch {
    // see setSessionToken
  }
}

export function clearStoredEmail(): void {
  try {
    localStorage.removeItem(ACCOUNT_EMAIL_KEY);
  } catch {
    // see setSessionToken
  }
}
