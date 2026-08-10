// Phase 30, Plan 09 (FSH-01/FSH-05): unit-level proof that the client's
// `CollectionRow`/`createCollection` wire-type mirror of 30-02's server-side
// `family_wide_kind` addition is byte-for-byte compatible with every
// existing call site. This is a fetch-spy-level test (no real WASM needed —
// `family_wide_kind` carries no key material, so there's nothing for WASM
// crypto to touch); `createCollection.real-wasm.test.ts` already proves the
// crypto round trip for the REST of this wrapper's contract and is
// untouched by this plan.
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCollection, type CollectionRow } from "./api";

describe("createCollection: family_wide_kind wire-contract mirror (30-09)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetchCapturingBody() {
    let capturedBody: string | undefined;
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as string | undefined;
      return new Response(
        JSON.stringify({
          id: "col-1",
          enc_name: "enc",
          created_at: "2026-08-10T00:00:00Z",
          access_level: "edit",
          sealed_key: "sealed",
          family_wide_kind: null,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);
    return { fetchSpy, getBody: () => capturedBody };
  }

  it("omits family_wide_kind entirely from the POST body when called with no 4th argument -- byte-for-byte identical to today's request shape", async () => {
    const { getBody } = stubFetchCapturingBody();

    await createCollection("col-1", "enc-name", "sealed-key");

    const body = JSON.parse(getBody() as string) as Record<string, unknown>;
    expect(body).toEqual({ id: "col-1", enc_name: "enc-name", sealed_key: "sealed-key" });
    expect("family_wide_kind" in body).toBe(false);
  });

  it("includes family_wide_kind in the POST body when the 4th argument is provided", async () => {
    const { getBody } = stubFetchCapturingBody();

    await createCollection("col-1", "enc-name", "sealed-key", "folder");

    const body = JSON.parse(getBody() as string) as Record<string, unknown>;
    expect(body).toEqual({
      id: "col-1",
      enc_name: "enc-name",
      sealed_key: "sealed-key",
      family_wide_kind: "folder",
    });
  });

  it("includes family_wide_kind: 'item_bucket' when that variant is passed", async () => {
    const { getBody } = stubFetchCapturingBody();

    await createCollection("col-1", "enc-name", "sealed-key", "item_bucket");

    const body = JSON.parse(getBody() as string) as Record<string, unknown>;
    expect(body.family_wide_kind).toBe("item_bucket");
  });

  it("CollectionRow.family_wide_kind round-trips through the response -- a response omitting the field entirely still type-checks (treated as null-equivalent, never a required key)", async () => {
    const fetchSpy = vi.fn(async () => {
      // Deliberately OMITS family_wide_kind from the response body --
      // simulates a server predating this phase's deploy (rolling
      // restart window). Must not throw on a missing key.
      return new Response(
        JSON.stringify({
          id: "col-1",
          enc_name: "enc",
          created_at: "2026-08-10T00:00:00Z",
          access_level: "edit",
          sealed_key: "sealed",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const row: CollectionRow = await createCollection("col-1", "enc-name", "sealed-key");
    // The field is absent on the wire in this simulated response; the type
    // contract still holds (TypeScript compile-time proof lives in the
    // `_collectionRowFamilyWideKind` fixture below), and the value read at
    // runtime is simply `undefined` -- never a thrown error.
    expect(row.family_wide_kind === null || row.family_wide_kind === undefined).toBe(true);
  });
});

// Typecheck-level proof (not a runtime assertion): if `family_wide_kind`
// were ever removed from `CollectionRow`, this literal fixture fails to
// compile under `npx tsc --noEmit` -- the wire field 30-02 added
// server-side has a client-side type to match.
const _collectionRowFamilyWideKind: CollectionRow["family_wide_kind"] = null;
void _collectionRowFamilyWideKind;
