# Privacy Policy — Passkey Vault

_Last updated: 2026-07-22_

Passkey Vault is a free, open-source, self-hostable password manager and passkey
provider (browser extension + web app + server). This policy covers the Passkey
Vault browser extension for Chrome and Firefox and, where noted, the server it
connects to.

## The short version

- **Zero-knowledge by design.** Your master password, encryption keys, passkey
  private keys, and the plaintext of every vault item **never leave your
  device**. All encryption and decryption happens locally (Argon2id,
  XChaCha20-Poly1305, HKDF-SHA256), inside the extension or web app.
- **You choose the server.** The extension talks only to the Passkey Vault
  server **you configure** — typically your own self-hosted instance. There is
  no vendor cloud, no third-party analytics, no telemetry, and no advertising.
- **What the server stores is ciphertext.** The server you point the extension
  at stores only encrypted blobs it cannot decrypt, plus the minimum metadata
  needed to operate (see below).

## Data the extension processes locally (never transmitted in plaintext)

- Vault items (logins, passwords, TOTP secrets, cards, identities, notes)
- Your master password and all derived encryption keys
- Passkeys created or used via the passkey-provider feature (WebAuthn), including
  PRF-based vault-unlock material
- Page-form context needed for autofill (detected login/signup fields on the
  page you are viewing) — used in-memory to offer autofill/save, never logged or
  transmitted

## Data transmitted to the server you configure

All communication is HTTPS-only. The configured server receives and stores:

- **Account identifier**: the e-mail address you register with, and a
  verifier derived from your master password (the server never receives the
  password itself)
- **Encrypted vault data**: item blobs and key-wrapping blobs encrypted on your
  device before upload (the server cannot decrypt them)
- **WebAuthn/passkey ceremony data**: public keys, credential IDs, signatures,
  and related non-secret metadata required by the WebAuthn standard
- **Operational metadata**: session tokens (stored server-side only as hashes),
  item revision counters, and timestamps needed for multi-device sync

Under Mozilla's data-collection taxonomy this is a transmission of
**authentication information**; it is client-side encrypted before it leaves
your browser.

## What we do NOT do

- No analytics, tracking, or telemetry of any kind
- No advertising, no data sale, no sharing with third parties
- No browsing-history collection — the extension inspects the current page only
  to detect credential forms for autofill, locally
- No remote code — all executable code (including the WebAssembly crypto core)
  ships inside the signed extension package

## Your server, your data

If you self-host the server, you are the data controller of your instance: data
lives in your SQLite database on your machine, retention and backups are under
your control, and deleting your account or database removes the data. If you use
an instance hosted by someone else, the encrypted blobs listed above are stored
on their server — but remain undecryptable without your master password or
enrolled passkey.

## Permissions used by the extension

| Permission | Why |
|---|---|
| `storage` | Store the configured server URL and non-secret settings; the unlocked vault key lives only in session storage that is cleared when the browser closes or the vault auto-locks |
| `alarms` | Run the auto-lock timer that re-locks your vault after inactivity |
| `activeTab` / `tabs` | Determine the current tab's origin to offer matching credentials and open the web vault |
| Content scripts on all sites | Detect login/signup forms to offer autofill, save-password, and password-generation UI, and to act as a passkey provider (`navigator.credentials`) on sites that use passkeys; the scripts hold no keys and read only form context |
| Optional host permissions | Granted by you at runtime for the specific server URL you configure |

## Changes and contact

This policy may be updated when features change; material changes are announced
in the release notes of the extension. Questions or reports:
<https://github.com/bartosz-skejcik/passkey-vault/issues>.
