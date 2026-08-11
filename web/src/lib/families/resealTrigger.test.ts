// 30-13-PLAN.md Task 1 (FSH-02): the lazy-reseal TRIGGER -- the fallback half
// of 30-DECISION-FSH-02.md's hybrid mechanism. Proves the three behaviors the
// decision record's own refinement depends on: it fires for EVERY resealable
// pair the current session can act on (never scoped to exclude the sharer),
// one pair's failure never aborts another's, and no pair is ever attempted
// twice within one session.
//
// `./reseal` is mocked wholesale here -- this file tests the TRIGGER's
// scheduling/dedup/failure-isolation logic, not the crypto composition
// (which has its own fast lane in `reseal.test.ts` and its own real-WASM
// proof in `reseal.real-wasm.test.ts`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WasmUserKey } from "@/lib/crypto";

const { mockReshare, mockGetCollection, mockGetSnapshot } = vi.hoisted(() => ({
  mockReshare: vi.fn(),
  mockGetCollection: vi.fn(),
  mockGetSnapshot: vi.fn(),
}));

vi.mock("./reseal", () => ({ reshareCollectionToNewMember: mockReshare }));
vi.mock("@/lib/vault/api", () => ({ getCollection: mockGetCollection }));
vi.mock("./familyWidePending", () => ({
  getFamilyWidePendingSnapshot: mockGetSnapshot,
}));

const FAKE_UK = {} as WasmUserKey;

/** Convenience: the `{missing, resealable}` wire shape with only the half
 * this trigger reads populated. */
function snapshot(resealable: { collection_id: string; recipient_user_id: string }[]) {
  return { missing: [], resealable };
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockReshare.mockResolvedValue(undefined);
  // CR-01 fix (30-REVIEW.md): `access_level` here is the RESEALER's own
  // held level -- deliberately a TRAP value, different from
  // `family_wide_access_level` (the level the share was actually created
  // at) below. Every existing assertion in this file expecting "edit" to
  // have been propagated is a live proof that the fix reads
  // `family_wide_access_level`, never `access_level` (the exact bug CR-01
  // describes: a resealer who happens to hold a DIFFERENT level than the
  // share's own declared one must never leak their own level into the
  // grant).
  mockGetCollection.mockResolvedValue({
    sealed_key: "own-sealed-blob",
    access_level: "hidden_password",
    family_wide_access_level: "edit",
  });
  mockGetSnapshot.mockReturnValue(snapshot([]));
  // The attempted-set is module-private and deliberately survives across
  // calls within one session -- clear it between tests through its OWN
  // exported reset (the same one store.ts calls on every unlock), rather
  // than by re-importing the module, so the reset itself is exercised on
  // every single test in this file.
  const { resetFamilyWideResealAttempts } = await import("./resealTrigger");
  resetFamilyWideResealAttempts();
});

describe("runFamilyWideResealTrigger", () => {
  it("calls reshareCollectionToNewMember exactly once per resealable entry, with that entry's own ids and the SHARE's own family_wide_access_level (never the resealer's own held access_level)", async () => {
    mockGetSnapshot.mockReturnValue(
      snapshot([
        { collection_id: "col-1", recipient_user_id: "user-a" },
        { collection_id: "col-2", recipient_user_id: "user-b" },
      ]),
    );

    const { runFamilyWideResealTrigger } = await import("./resealTrigger");
    await runFamilyWideResealTrigger(FAKE_UK);

    expect(mockReshare).toHaveBeenCalledTimes(2);
    expect(mockReshare).toHaveBeenCalledWith("col-1", "user-a", "edit", FAKE_UK);
    expect(mockReshare).toHaveBeenCalledWith("col-2", "user-b", "edit", FAKE_UK);
  });

  it("falls back to FALLBACK_ACCESS_LEVEL ('read') when the collection carries no family_wide_access_level (a legacy/pre-migration row) -- never falls back to the resealer's OWN access_level", async () => {
    mockGetCollection.mockResolvedValue({
      sealed_key: "own-sealed-blob",
      access_level: "edit", // trap: must NOT be used as the fallback
      family_wide_access_level: null,
    });
    mockGetSnapshot.mockReturnValue(snapshot([{ collection_id: "col-1", recipient_user_id: "user-a" }]));

    const { runFamilyWideResealTrigger } = await import("./resealTrigger");
    await runFamilyWideResealTrigger(FAKE_UK);

    expect(mockReshare).toHaveBeenCalledWith("col-1", "user-a", "read", FAKE_UK);
  });

  it("one entry's rejection never blocks or aborts another entry's reseal, and the trigger itself still resolves", async () => {
    mockGetSnapshot.mockReturnValue(
      snapshot([
        { collection_id: "col-1", recipient_user_id: "user-a" },
        { collection_id: "col-2", recipient_user_id: "user-b" },
      ]),
    );
    mockReshare.mockImplementation((collectionId: string) =>
      collectionId === "col-1"
        ? Promise.reject(new Error("transient network failure"))
        : Promise.resolve(undefined),
    );

    const { runFamilyWideResealTrigger } = await import("./resealTrigger");
    await expect(runFamilyWideResealTrigger(FAKE_UK)).resolves.toBeUndefined();

    // BOTH were invoked despite the first one rejecting.
    expect(mockReshare).toHaveBeenCalledTimes(2);
    expect(mockReshare).toHaveBeenCalledWith("col-1", "user-a", "edit", FAKE_UK);
    expect(mockReshare).toHaveBeenCalledWith("col-2", "user-b", "edit", FAKE_UK);
  });

  it("never re-attempts the SAME (collection_id, recipient_user_id) pair within one session, even when a second snapshot still reports it", async () => {
    mockGetSnapshot.mockReturnValue(snapshot([{ collection_id: "col-1", recipient_user_id: "user-a" }]));

    const { runFamilyWideResealTrigger } = await import("./resealTrigger");
    await runFamilyWideResealTrigger(FAKE_UK);
    await runFamilyWideResealTrigger(FAKE_UK);

    expect(mockReshare).toHaveBeenCalledTimes(1);
  });

  it("still attempts the OTHER pairs in a second snapshot that also repeats an already-attempted one", async () => {
    mockGetSnapshot.mockReturnValue(snapshot([{ collection_id: "col-1", recipient_user_id: "user-a" }]));
    const { runFamilyWideResealTrigger } = await import("./resealTrigger");
    await runFamilyWideResealTrigger(FAKE_UK);

    mockGetSnapshot.mockReturnValue(
      snapshot([
        { collection_id: "col-1", recipient_user_id: "user-a" },
        { collection_id: "col-1", recipient_user_id: "user-b" },
      ]),
    );
    await runFamilyWideResealTrigger(FAKE_UK);

    expect(mockReshare).toHaveBeenCalledTimes(2);
    expect(mockReshare).toHaveBeenCalledWith("col-1", "user-b", "edit", FAKE_UK);
  });

  it("marks a pair attempted BEFORE awaiting, so two overlapping runs in the same tick cannot double-fire", async () => {
    mockGetSnapshot.mockReturnValue(snapshot([{ collection_id: "col-1", recipient_user_id: "user-a" }]));

    const { runFamilyWideResealTrigger } = await import("./resealTrigger");
    await Promise.all([runFamilyWideResealTrigger(FAKE_UK), runFamilyWideResealTrigger(FAKE_UK)]);

    expect(mockReshare).toHaveBeenCalledTimes(1);
  });

  it("resetFamilyWideResealAttempts() re-arms a pair for a fresh session (the next unlock re-attempts what a failed run left undone)", async () => {
    mockGetSnapshot.mockReturnValue(snapshot([{ collection_id: "col-1", recipient_user_id: "user-a" }]));
    mockReshare.mockRejectedValue(new Error("transient network failure"));

    const { runFamilyWideResealTrigger, resetFamilyWideResealAttempts } = await import(
      "./resealTrigger"
    );
    await runFamilyWideResealTrigger(FAKE_UK);
    expect(mockReshare).toHaveBeenCalledTimes(1);

    resetFamilyWideResealAttempts();
    mockReshare.mockResolvedValue(undefined);
    await runFamilyWideResealTrigger(FAKE_UK);

    expect(mockReshare).toHaveBeenCalledTimes(2);
  });

  it("never reseals a collection the CURRENT session itself lacks a sealed_key for (that is the missing side, not this trigger's job)", async () => {
    mockGetSnapshot.mockReturnValue(
      snapshot([
        { collection_id: "col-missing", recipient_user_id: "user-a" },
        { collection_id: "col-held", recipient_user_id: "user-b" },
      ]),
    );
    mockGetCollection.mockImplementation((id: string) =>
      Promise.resolve(
        id === "col-missing"
          ? { sealed_key: null, access_level: null, family_wide_access_level: null }
          : { sealed_key: "own-sealed-blob", access_level: "edit", family_wide_access_level: "read" },
      ),
    );

    const { runFamilyWideResealTrigger } = await import("./resealTrigger");
    await runFamilyWideResealTrigger(FAKE_UK);

    expect(mockReshare).toHaveBeenCalledTimes(1);
    expect(mockReshare).toHaveBeenCalledWith("col-held", "user-b", "read", FAKE_UK);
  });

  it("does zero work -- not even a getCollection round trip -- when nothing is resealable (T-30-21)", async () => {
    mockGetSnapshot.mockReturnValue(snapshot([]));

    const { runFamilyWideResealTrigger } = await import("./resealTrigger");
    await runFamilyWideResealTrigger(FAKE_UK);

    expect(mockGetCollection).not.toHaveBeenCalled();
    expect(mockReshare).not.toHaveBeenCalled();
  });

  it("reads the synchronous snapshot only -- it never calls the discovery endpoint itself (one query, two consumers)", async () => {
    mockGetSnapshot.mockReturnValue(snapshot([{ collection_id: "col-1", recipient_user_id: "user-a" }]));

    const familiesApi = await import("./api");
    const spy = vi.spyOn(familiesApi, "getFamilyWidePending");

    const { runFamilyWideResealTrigger } = await import("./resealTrigger");
    await runFamilyWideResealTrigger(FAKE_UK);

    expect(spy).not.toHaveBeenCalled();
    expect(mockGetSnapshot).toHaveBeenCalled();
  });
});
