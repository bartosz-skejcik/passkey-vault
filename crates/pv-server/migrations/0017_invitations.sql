-- Single-use, no-SMTP family/collection invitation links (FAM-04, FAM-05,
-- FAM-06; 24-CONTEXT.md Amendment 2's proof-of-possession leg). Additive
-- only, continuing 0014/0015/0016's numbering and header-comment convention:
-- no existing column is renamed or repurposed, and every existing row keeps
-- its current behavior byte-for-byte. Accounts with no family keep working
-- exactly as today (24-CONTEXT.md hard constraint #5).
--
-- `id` is the client-computed `invite_id` — HKDF-derived from a 32-byte
-- `invite_secret` the server never sees, safe to expose as a public lookup
-- handle, and used directly as this table's PRIMARY KEY (never generated
-- server-side, unlike every other `TEXT PRIMARY KEY` in this schema).
--
-- `collection_id`/`access_level`/`wrapped_collection_key` travel together:
-- either all three are NULL (a family-only invite) or all three are NOT NULL
-- (a family-join plus a collection grant) — the table-level CHECK below
-- forbids any partial state. `wrapped_collection_key` is opaque `WrappedKey`
-- JSON (nonce+ciphertext) produced by `pv_core::invite::wrap_collection_key_for_invite`
-- — this server never unwraps it, mirroring `collection_keys.sealed_key`'s
-- own "opaque blob" discipline.
--
-- `proof_hash` (Amendment 2) is `SHA-256(invite_proof)`, submitted by the
-- INVITER's client at creation time — a plain fixed-length digest with no
-- nonce/ciphertext structure, so it gets a raw `BLOB` column (mirroring
-- `user_keypairs.public_key BLOB`'s convention), not a WrappedKey-shaped JSON
-- TEXT column. The server stores only this hash and never sees the raw
-- `invite_proof` at creation time; `invite_proof` is a one-way HKDF
-- derivation of `invite_secret` under its own domain-separation constant,
-- independent of `invite_id`/`invite_wrap_key`, so learning `proof_hash`
-- reveals neither the secret nor the wrap key. Without this leg, `invite_id`
-- alone (observable in a server/proxy access log or a `Referer` header) would
-- be redeemable by anyone who merely saw it — T-24-07, closed by this column
-- plus the redemption-time comparison a later plan in this phase adds.
--
-- No `role` column: v0.4's flat model only ever adds an invited member as
-- `family_members.role = 'member'` (matching `families::add_member`'s own
-- hardcoded literal) — there is no "invite someone as owner" concept.
--
-- `failed_attempts` (24-CONTEXT.md Amendment 1) is a PERSISTED per-invite_id
-- rate-limit counter, not an in-process map — the "1 container, no external
-- services" constraint rules out a dedicated rate-limiting dependency, and an
-- in-process map dies on every container restart anyway. Amendment 2 extends
-- this same counter to also count a failed proof-of-possession check, not
-- only a failed accept. Incremented inside the same transaction a later
-- plan's redemption handler already writes, so it costs nothing extra.
--
-- `status` follows this schema's established `CHECK`-constrained closed-set
-- convention (`collection_keys.access_level`, `family_members.role`) — a
-- three-value lifecycle (`pending` -> `accepted` | `revoked`), enforced at
-- the DB level, decoded on the Rust side by the sole trusted decoder.
CREATE TABLE invitations (
    id                      TEXT PRIMARY KEY,
    family_id               TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    collection_id           TEXT REFERENCES collections(id) ON DELETE CASCADE,
    inviter_user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_level            TEXT CHECK (access_level IN ('read','edit','hidden_password')),
    wrapped_collection_key  TEXT,
    proof_hash              BLOB NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
    failed_attempts         INTEGER NOT NULL DEFAULT 0,
    expires_at              TEXT NOT NULL,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (
        (collection_id IS NULL AND access_level IS NULL AND wrapped_collection_key IS NULL)
        OR
        (collection_id IS NOT NULL AND access_level IS NOT NULL AND wrapped_collection_key IS NOT NULL)
    )
);
CREATE INDEX idx_invitations_family ON invitations(family_id);
