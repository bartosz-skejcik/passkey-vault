// Invite crypto orchestration glue (Plan 24-05) — the layer between
// lib/invite/api.ts's thin HTTP wrappers and lib/crypto's WASM bindings.
// Owns the fragment-secret lifecycle (capture-before-zeroize, T-24-12), the
// Amendment 2 proof-of-possession derivation, and the
// fragment-vs-path invite_id self-consistency check that must run BEFORE
// any network call (T-24-13).
//
// `fetchInviteMetadataFlow` and `redeemInviteFlow` each derive their OWN
// `WasmInviteChannel` independently from the `secretFragment` string — cheap
// (a few HKDF calls) rather than threading one WASM object across two
// separate async call sites/React state. The precious value that must
// survive the invite flow (including the inline-register round trip) is the
// `secretFragment` STRING itself, held only in React state by the caller —
// never persisted to localStorage/sessionStorage anywhere in this module.
import {
  initCrypto,
  WasmInviteChannel,
  WasmIdentityPublicKey,
  generateInviteSecret,
  sealCollectionKey,
  unsealCollectionKey,
  type WasmUserKey,
  type WasmCollectionKey,
} from "@/lib/crypto";
import { base64Encode, base64Decode } from "@/lib/auth/api";
import { ensureOwnIdentityKeypair } from "@/lib/identity/ensure";
import { getCollection, listCollections } from "@/lib/vault/api";
import { createInvite, fetchInvitePublicMetadata, redeemInvite } from "./api";
import type { InvitePublicMetadata, FamilyWideKeyEntry, FamilyWideSealedKeyEntry } from "./api";

/**
 * RFC 4648 §5 URL-safe transform over the STANDARD base64Encode/base64Decode
 * helpers from lib/auth/api — used ONLY for the fragment secret. Every proof
 * value (the creation-time hash, the redemption-time raw proof) travels in a
 * JSON body and stays STANDARD-encoded like every other binary JSON field in
 * this codebase; conflating the two encodings would silently corrupt
 * whichever one used the wrong alphabet.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingNeeded = (4 - (standard.length % 4)) % 4;
  return base64Decode(standard + "=".repeat(paddingNeeded));
}

export type InviteScope =
  | { kind: "family" }
  | { kind: "collection"; collectionId: string; accessLevel: "read" | "edit" | "hidden_password" };

export type InviteExpiry = "1h" | "24h" | "7d";

/**
 * Generates a fresh invite link. Calls `ensureOwnIdentityKeypair`
 * unconditionally first — structurally required for a collection scope
 * (the Collection Key must be re-wrapped under the invite channel), and
 * needed for fingerprint availability on a family-only scope too
 * (24-UI-SPEC.md's cross-phase gap note).
 */
export async function generateInviteLink(
  scope: InviteScope,
  expiresIn: InviteExpiry,
  uk: WasmUserKey,
): Promise<{ url: string; expiresAt: string }> {
  // WASM musi być zainstancjonowane przed pierwszym wywołaniem krypto —
  // memoizowany singleton (lib/crypto's own `ready` promise), więc kolejne
  // wywołania są darmowe. Plan 24-08 gap-fix: this call site (like the two
  // below) previously relied entirely on page.tsx's fire-and-forget
  // "Rozgrzewka WASM" warm-up having already won its race against whatever
  // triggered this call — true for the owner's OWN Settings-panel flow
  // (already unlocked via RegisterForm/LoginForm, which DOES await this),
  // but never guaranteed, and every other WASM-touching entry point in this
  // codebase (RegisterForm/LoginForm/UnlockOverlay) awaits this explicitly
  // rather than depending on that race.
  await initCrypto();
  const identityKey = await ensureOwnIdentityKeypair(uk);
  let channel: WasmInviteChannel | undefined;
  let collectionKey: WasmCollectionKey | undefined;
  const familyWideCollectionKeys: WasmCollectionKey[] = [];
  try {
    const secretBytes = generateInviteSecret();
    // Captured BEFORE the next call — WasmInviteChannel.fromSecret zeroizes
    // its input buffer (and, via wasm-bindgen's mutable-slice copy-back,
    // this JS-side view of it too), exactly like WasmWrappingKey.fromPassword
    // already does.
    const secretForUrl = base64UrlEncode(secretBytes);
    channel = WasmInviteChannel.fromSecret(secretBytes);
    const inviteId = channel.inviteId();
    // STANDARD encoding — this is a JSON body field, not a URL segment.
    const proofHash = base64Encode(channel.proofHashForCreation());

    // 30-DECISION-FSH-02.md's invite-time-wrap fast path: fold in every
    // family-wide collection the caller currently holds a key for, ADDITIVE
    // to whatever single explicit collection scope this invite already
    // carries below — never mutually exclusive with it. `listCollections()`
    // is an existing client call gated by the caller already holding
    // `collection_keys` rows, never a new server round trip.
    const ownCollections = await listCollections();
    const familyWideKeys: FamilyWideKeyEntry[] = [];
    for (const entry of ownCollections) {
      if (entry.family_wide_kind == null) continue;
      // Defensive — every family-wide row returned here should carry both
      // fields together (same `collection_keys` row), but never hardcode a
      // fallback access_level if either is unexpectedly absent.
      if (entry.sealed_key === null || entry.access_level == null) continue;
      const ck = unsealCollectionKey(identityKey, entry.sealed_key);
      familyWideCollectionKeys.push(ck);
      familyWideKeys.push({
        collection_id: entry.id,
        access_level: entry.access_level,
        wrapped_collection_key: channel.wrapCollectionKey(ck),
      });
    }

    let wrappedForInvite: string | null = null;
    if (scope.kind === "collection") {
      const collectionRecord = await getCollection(scope.collectionId);
      if (collectionRecord.sealed_key === null) {
        throw new Error("caller has no sealed_key for this collection — cannot create an invite for it");
      }
      collectionKey = unsealCollectionKey(identityKey, collectionRecord.sealed_key);
      wrappedForInvite = channel.wrapCollectionKey(collectionKey);
    }

    const response = await createInvite({
      id: inviteId,
      collection_id: scope.kind === "collection" ? scope.collectionId : null,
      access_level: scope.kind === "collection" ? scope.accessLevel : null,
      wrapped_collection_key: scope.kind === "collection" ? wrappedForInvite : null,
      family_wide_keys: familyWideKeys,
      // Amendment 2: ONLY the hash ever travels to createInvite — never the
      // raw invite_proof (that is fetchInviteMetadataFlow/redeemInviteFlow's
      // job, at redemption time, via a DIFFERENT channel method).
      proof_hash: proofHash,
      expires_in: expiresIn,
    });

    return {
      url: `${window.location.origin}/invite/${inviteId}#${secretForUrl}`,
      expiresAt: response.expires_at,
    };
  } finally {
    familyWideCollectionKeys.forEach((k) => k.free?.());
    collectionKey?.free?.();
    channel?.free?.();
    identityKey.free?.();
  }
}

/**
 * The orchestration entry point Plan 24-06's `InviteLandingView` calls at
 * mount — it must NOT call the raw `fetchInvitePublicMetadata` from
 * `lib/invite/api.ts` directly, since that function alone cannot derive
 * `invite_proof`.
 */
export async function fetchInviteMetadataFlow(
  inviteId: string,
  secretFragment: string,
): Promise<InvitePublicMetadata> {
  // Plan 24-08 gap-fix (found via a REAL browser end-to-end run, never
  // caught by any unit test — every unit test mocks `@/lib/crypto` wholesale,
  // so this missing await never mattered there): a brand-new visitor landing
  // directly on `/invite/{id}#<secret>` has NEVER triggered any other
  // WASM-touching code yet, so `WasmInviteChannel.fromSecret` below could
  // race page.tsx's own fire-and-forget warm-up and run before the wasm
  // module finishes instantiating, throwing and collapsing straight into the
  // unified "invalid" state with no network call ever made. See
  // `generateInviteLink`'s identical fix above for the full rationale.
  await initCrypto();
  const secretBytes = base64UrlDecode(secretFragment);
  const channel = WasmInviteChannel.fromSecret(secretBytes);
  try {
    // Self-consistency check BEFORE any API call — a malformed/tampered
    // link is caught here, not surfaced as a confusing server error.
    if (channel.inviteId() !== inviteId) {
      throw new Error("invite link's fragment does not correspond to its own path invite_id");
    }
    const inviteProof = base64Encode(channel.proofForRedemption());
    return await fetchInvitePublicMetadata(inviteId, inviteProof);
  } finally {
    channel.free?.();
  }
}

/**
 * Redeems an invite. Checked independently from `fetchInviteMetadataFlow`'s
 * own self-consistency check, since this function may be called on its own
 * retry path (Plan 24-06's `joinFailedRetryable` state). Derives
 * `invite_proof` ONCE and reuses the SAME value for both the metadata fetch
 * and the accept call — never re-derived with a chance to drift.
 */
export async function redeemInviteFlow(
  inviteId: string,
  secretFragment: string,
  uk: WasmUserKey,
): Promise<{ alreadyMember: boolean; collectionId: string | null }> {
  // Plan 24-08 gap-fix — see `fetchInviteMetadataFlow`'s identical comment
  // above; this call site is reachable independently (the `joinFailedRetryable`
  // retry path calls this without a preceding `fetchInviteMetadataFlow` in
  // the same tick), so it needs its own await, not a shared one.
  await initCrypto();
  const secretBytes = base64UrlDecode(secretFragment);
  const channel = WasmInviteChannel.fromSecret(secretBytes);
  let identityKey: Awaited<ReturnType<typeof ensureOwnIdentityKeypair>> | undefined;
  let collectionKey: WasmCollectionKey | undefined;
  // 30-DECISION-FSH-02.md's invite-time-wrap fast path, redemption side: the
  // family-wide analog of `collectionKey`/`myPublicKey` above, one handle
  // per `metadata.family_wide_keys` entry. Freed in the SAME outer `finally`
  // block below as every other handle in this function — never a
  // per-iteration nested one — so no handle can leak across either path.
  const familyWideCollectionKeys: WasmCollectionKey[] = [];
  const familyWidePublicKeys: WasmIdentityPublicKey[] = [];
  try {
    if (channel.inviteId() !== inviteId) {
      throw new Error("invite link's fragment does not correspond to its own path invite_id");
    }
    const inviteProof = base64Encode(channel.proofForRedemption());
    const metadata = await fetchInvitePublicMetadata(inviteId, inviteProof);

    identityKey = await ensureOwnIdentityKeypair(uk);

    let sealedForSelf: string | undefined;
    if (metadata.wrapped_collection_key !== null) {
      collectionKey = channel.unwrapCollectionKey(metadata.wrapped_collection_key);
      const myPublicKey = WasmIdentityPublicKey.fromBytes(identityKey.publicKeyBytes());
      try {
        // The invitee's self-seal to their OWN identity key — never the
        // inviter's — so the resulting `sealed_for_self` blob is only ever
        // decryptable by the account actually redeeming this invite.
        sealedForSelf = sealCollectionKey(myPublicKey, collectionKey);
      } finally {
        myPublicKey.free?.();
      }
    }

    // Self-seal every family-wide key this invite's metadata carried, to
    // the invitee's OWN freshly-published identity key — the same per-entry
    // pattern the single-collection branch above already uses, threaded N
    // times. `metadata.family_wide_keys` is optional (absent means the same
    // as `[]` — see `InvitePublicMetadata`'s own doc comment).
    const familyWideSealedKeys: FamilyWideSealedKeyEntry[] = [];
    for (const entry of metadata.family_wide_keys ?? []) {
      const fwCollectionKey = channel.unwrapCollectionKey(entry.wrapped_collection_key);
      familyWideCollectionKeys.push(fwCollectionKey);
      const fwPublicKey = WasmIdentityPublicKey.fromBytes(identityKey.publicKeyBytes());
      familyWidePublicKeys.push(fwPublicKey);
      familyWideSealedKeys.push({
        collection_id: entry.collection_id,
        sealed_for_self: sealCollectionKey(fwPublicKey, fwCollectionKey),
      });
    }

    // The SAME `inviteProof` derived above, reused, never re-derived.
    const response = await redeemInvite(inviteId, {
      invite_proof: inviteProof,
      sealed_for_self: sealedForSelf,
      family_wide_sealed_keys: familyWideSealedKeys,
    });

    return { alreadyMember: response.already_member, collectionId: metadata.collection_id };
  } finally {
    familyWideCollectionKeys.forEach((k) => k.free?.());
    familyWidePublicKeys.forEach((k) => k.free?.());
    collectionKey?.free?.();
    identityKey?.free?.();
    channel.free?.();
  }
}
