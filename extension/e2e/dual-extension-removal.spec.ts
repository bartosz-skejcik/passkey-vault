// extension/e2e/dual-extension-removal.spec.ts -- 28-03-PLAN.md: the live
// proof that closes v0.4 audit Blocker 3 (FAM-07/08/09, KEY-06) for the
// EXTENSION client. Three tests land here across this plan's Tasks 2/3/5:
//
//   1. (Task 2) Fixture-validation smoke test -- proves the real,
//      exact-set-comparison-satisfying member-removal batch this file's own
//      `setupFamilyRemovalFixture()` builds is genuinely ACCEPTED (204, not
//      409) and genuinely revokes server-side access, with ZERO involvement
//      of any extension page/popup. This isolates the phase's highest-risk
//      crypto-construction work (Pitfall 2: `apply_member_removal_rekey`'s
//      exact-set guards 409 a bare/empty/wrong batch) from the UI-behavior
//      proof, per plan-checker feedback that the original bundled task
//      carried too much risk in one place.
//   2. (Task 3) The extension-UI purge proof -- closes the two-call-site
//      race the plan-review blocker identified (sync-client.ts's
//      `hasEverConfirmedFamilyMembership` armed by BOTH `pullOnce()` and
//      `vault-store.ts`'s earlier `refreshSharedItemsNow()`).
//   3. (Task 5) The suspension direct-bucket signal proof, both directions.
//
// Deliberately a DIFFERENT server path from `dual-extension-revocation.spec.ts`
// (which proves `collections::revoke_access`, a per-collection revoke) --
// this file proves `families.rs::remove_member`/`suspend_member`/
// `reinstate_member`, the whole-family-membership path. Per this plan's own
// Pitfall 1, `dual-extension-revocation.spec.ts`'s own mechanism is never
// touched or re-tested here.
//
// Headless is fine -- no WebAuthn ceremony anywhere in this spec (only the
// password-sign-in branch of the server-origin ceremony window, identical to
// dual-extension-revocation.spec.ts's own precedent), so this spec runs in
// the `chromium` project (not `chromium-ceremony`).
import { expect, test } from "./fixtures";
import { setupFamilyRemovalFixture } from "./fixtures-account-setup";

test("Task 2: the real member-removal batch is accepted (204, not 409) and genuinely severs the target's server-side access, with zero extension-page involvement", async () => {
  // Real Argon2id KDF (register/login for owner + target) + a real
  // Collection-Key generate/seal/unseal/rewrap sequence -- generous but
  // bounded (no polling/waiting in this test, only real crypto + REST).
  test.setTimeout(60_000);

  const fixture = await setupFamilyRemovalFixture();

  // PRESENCE first (this codebase's own established discipline for a
  // negative assertion -- see dual-extension-revocation.spec.ts's own header
  // comment): before removal, the target's OWN session genuinely has access.
  const preRemovalAccessRes = await fixture.fetchAsTarget(
    `/api/vault/collections/${fixture.collectionId}/access`,
  );
  expect(
    preRemovalAccessRes.status,
    "the target's own session must have live collection access before removal",
  ).toBe(200);

  const preRemovalSharedRes = await fixture.fetchAsTarget("/api/sync/shared");
  expect(
    preRemovalSharedRes.status,
    "the target's own session must have a live family membership before removal",
  ).toBe(200);

  // Trigger the real removal -- Pitfall 2: `removeTargetMember` builds a
  // REAL, exact-set-matching batch (never a bare/empty one) and submits
  // `DELETE /api/families/members/{target}`. A 409 here means the batch's
  // own construction is wrong (a missing collection/item/recipient against
  // the server's exact-set-comparison guard); this call itself asserts
  // success via its own `removeRes.status !== 204` throw.
  await fixture.removeTargetMember();

  // ABSENCE second, on BOTH the collection-access endpoint (the
  // per-collection re-key half, KEY-06) AND `/api/sync/shared` (the
  // whole-family-membership half, B-7's own discriminant endpoint -- this
  // is the SAME 404 the rest of this plan's client-side fix distinguishes
  // from "never had a family"). Both via the target's OWN, STILL-VALID
  // session token -- no re-login, no token reissue, proving server-side
  // enforcement is genuinely immediate on the next request.
  const postRemovalAccessRes = await fixture.fetchAsTarget(
    `/api/vault/collections/${fixture.collectionId}/access`,
  );
  expect(
    postRemovalAccessRes.status,
    "the target's own session must lose collection access on its very next request",
  ).toBe(404);

  const postRemovalSharedRes = await fixture.fetchAsTarget("/api/sync/shared");
  expect(
    postRemovalSharedRes.status,
    "the target's own session must lose family membership (the B-7 discriminant endpoint) on its very next request",
  ).toBe(404);
});
