import { beforeEach, describe, expect, it, vi } from "vitest";
import { base64Decode, base64Encode } from "@/lib/auth/api";

// --- Fake WASM layer -------------------------------------------------------
// `@/lib/crypto` is mocked wholesale (mirrors lib/passkeys/enroll.test.ts's
// convention of mocking the crypto boundary, not raw wasm). The fakes below
// implement just enough of the REAL invariants (proofHashForCreation !==
// proofForRedemption; wrap/unwrap round-trips through the SAME channel;
// inviteId is deterministic from the secret) to make this suite's
// assertions meaningful without depending on the compiled wasm binary.

// vi.mock() factories are hoisted above every other top-level statement in
// this file (including class declarations), so every symbol a factory
// references must be constructed INSIDE a vi.hoisted() block, not merely
// declared above it in source order.
const {
  deriveInviteId,
  deriveProofForRedemption,
  deriveProofHashForCreation,
  FakeCollectionKey,
  FakeInviteChannel,
  mockGenerateInviteSecret,
  mockUnsealCollectionKey,
  mockSealCollectionKey,
} = vi.hoisted(() => {
  function deriveInviteId(secret: Uint8Array): string {
    return `invite-id-${Array.from(secret).join(".")}`;
  }
  function deriveProofForRedemption(secret: Uint8Array): Uint8Array {
    return new Uint8Array(Array.from(secret).map((b) => b ^ 0xaa));
  }
  function deriveProofHashForCreation(secret: Uint8Array): Uint8Array {
    return new Uint8Array(Array.from(secret).map((b) => b ^ 0x55));
  }

  class FakeCollectionKey {
    bytes: Uint8Array;
    free: () => void;
    constructor(bytes: Uint8Array) {
      this.bytes = bytes;
      this.free = () => {};
    }
  }

  class FakeInviteChannel {
    private secretCopy: Uint8Array;
    private id: string;
    free: () => void;
    constructor(secret: Uint8Array) {
      this.secretCopy = Uint8Array.from(secret);
      this.id = deriveInviteId(this.secretCopy);
      // Mirrors the real WasmInviteChannel.fromSecret zeroizing its input.
      secret.fill(0);
      this.free = () => {};
    }
    static fromSecret(secret: Uint8Array): FakeInviteChannel {
      return new FakeInviteChannel(secret);
    }
    inviteId(): string {
      return this.id;
    }
    proofForRedemption(): Uint8Array {
      return deriveProofForRedemption(this.secretCopy);
    }
    proofHashForCreation(): Uint8Array {
      return deriveProofHashForCreation(this.secretCopy);
    }
    wrapCollectionKey(ck: InstanceType<typeof FakeCollectionKey>): string {
      return JSON.stringify({ inviteId: this.id, bytes: Array.from(ck.bytes) });
    }
    unwrapCollectionKey(wrappedJson: string): InstanceType<typeof FakeCollectionKey> {
      const parsed = JSON.parse(wrappedJson) as { inviteId: string; bytes: number[] };
      if (parsed.inviteId !== this.id) {
        throw new Error("wrapped under a different invite channel");
      }
      return new FakeCollectionKey(new Uint8Array(parsed.bytes));
    }
  }

  return {
    deriveInviteId,
    deriveProofForRedemption,
    deriveProofHashForCreation,
    FakeCollectionKey,
    FakeInviteChannel,
    mockGenerateInviteSecret: vi.fn(),
    mockUnsealCollectionKey: vi.fn(),
    mockSealCollectionKey: vi.fn(),
  };
});

vi.mock("@/lib/crypto", () => ({
  // Plan 24-08 gap-fix: `generateInviteLink`/`fetchInviteMetadataFlow`/
  // `redeemInviteFlow` now `await initCrypto()` first (a real e2e run
  // surfaced that the missing await let a brand-new invitee's metadata fetch
  // race the app's fire-and-forget WASM warm-up and lose) — this mock's own
  // resolved no-op keeps every existing assertion below unchanged.
  initCrypto: vi.fn().mockResolvedValue(undefined),
  WasmInviteChannel: FakeInviteChannel,
  WasmIdentityPublicKey: { fromBytes: (bytes: Uint8Array) => ({ bytes, free: vi.fn() }) },
  generateInviteSecret: mockGenerateInviteSecret,
  unsealCollectionKey: mockUnsealCollectionKey,
  sealCollectionKey: mockSealCollectionKey,
}));

const { mockEnsureOwnIdentityKeypair } = vi.hoisted(() => ({
  mockEnsureOwnIdentityKeypair: vi.fn(),
}));
vi.mock("@/lib/identity/ensure", () => ({ ensureOwnIdentityKeypair: mockEnsureOwnIdentityKeypair }));

const { mockGetCollection, mockListCollections } = vi.hoisted(() => ({
  mockGetCollection: vi.fn(),
  mockListCollections: vi.fn(),
}));
vi.mock("@/lib/vault/api", () => ({ getCollection: mockGetCollection, listCollections: mockListCollections }));

import {
  generateInviteLink,
  fetchInviteMetadataFlow,
  redeemInviteFlow,
  base64UrlEncode,
  base64UrlDecode,
} from "./crypto";
import type { WasmUserKey } from "@/lib/crypto";

const FAKE_UK = {} as WasmUserKey;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fixedSecret(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("location", { origin: "https://vault.example" });
  mockEnsureOwnIdentityKeypair.mockResolvedValue({
    publicKeyBytes: () => new Uint8Array([7, 7, 7, 7]),
    free: vi.fn(),
  });
  // Zero family-wide collections by default — every pre-existing test below
  // (which predates 30-07) exercises the byte-identical-to-today path
  // without needing to know this mock exists.
  mockListCollections.mockResolvedValue([]);
});

describe("generateInviteLink", () => {
  it("family-only: sends proof_hash (not the raw redemption proof) and produces a self-consistent url", async () => {
    const secret = fixedSecret(3);
    mockGenerateInviteSecret.mockReturnValue(secret);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(201, { id: deriveInviteId(fixedSecret(3)), expires_at: "2026-08-07T00:00:00Z" }),
    );

    const result = await generateInviteLink({ kind: "family" }, "7d", FAKE_UK);

    expect(mockGetCollection).not.toHaveBeenCalled();

    const createCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[0]).toContain("/api/invitations");
    const createBody = JSON.parse(createCall[1].body as string) as {
      proof_hash: string;
      collection_id: string | null;
    };
    expect(createBody.collection_id).toBeNull();

    const sentProofHash = base64Decode(createBody.proof_hash);
    const rawRedemptionProof = deriveProofForRedemption(fixedSecret(3));
    // The hash sent to createInvite must never equal the raw redemption
    // proof derived from the same secret — proving the two are never
    // conflated (T-24-24).
    expect(Array.from(sentProofHash)).not.toEqual(Array.from(rawRedemptionProof));
    expect(Array.from(sentProofHash)).toEqual(Array.from(deriveProofHashForCreation(fixedSecret(3))));

    // Self-consistency: decoding the fragment reconstructs the same
    // invite_id as the URL's own path segment.
    const url = new URL(result.url);
    const pathInviteId = url.pathname.split("/").pop();
    const fragmentSecret = base64UrlDecode(url.hash.slice(1));
    const reconstructedId = FakeInviteChannel.fromSecret(fragmentSecret).inviteId();
    expect(reconstructedId).toBe(pathInviteId);
  });

  it("collection-scoped: re-wraps the SAME Collection Key, never generating a fresh one", async () => {
    const secret = fixedSecret(5);
    mockGenerateInviteSecret.mockReturnValue(secret);
    const originalBytes = new Uint8Array([9, 8, 7, 6, 5]);
    mockGetCollection.mockResolvedValue({ sealed_key: "sealed-blob" });
    mockUnsealCollectionKey.mockReturnValue(new FakeCollectionKey(originalBytes));
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(201, { id: deriveInviteId(fixedSecret(5)), expires_at: "2026-08-07T00:00:00Z" }),
    );

    const result = await generateInviteLink(
      { kind: "collection", collectionId: "col-1", accessLevel: "read" },
      "1h",
      FAKE_UK,
    );

    const createCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const createBody = JSON.parse(createCall[1].body as string) as {
      collection_id: string;
      access_level: string;
      wrapped_collection_key: string;
    };
    expect(createBody.collection_id).toBe("col-1");
    expect(createBody.access_level).toBe("read");

    // Reconstruct a channel from the SAME secret (via the url fragment) and
    // unwrap what was sent — must round-trip to the identical key bytes.
    const url = new URL(result.url);
    const fragmentSecret = base64UrlDecode(url.hash.slice(1));
    const channel = FakeInviteChannel.fromSecret(fragmentSecret);
    const unwrapped = channel.unwrapCollectionKey(createBody.wrapped_collection_key);
    expect(Array.from(unwrapped.bytes)).toEqual(Array.from(originalBytes));
  });

  it("family-only invite folds in every current family-wide collection's key, additively (30-07)", async () => {
    const secret = fixedSecret(11);
    mockGenerateInviteSecret.mockReturnValue(secret);
    mockListCollections.mockResolvedValue([
      {
        id: "col-folder",
        enc_name: "n",
        created_at: "t",
        access_level: "edit",
        sealed_key: "sealed-folder",
        family_wide_kind: "folder",
      },
      {
        id: "col-bucket",
        enc_name: "n",
        created_at: "t",
        access_level: "read",
        sealed_key: "sealed-bucket",
        family_wide_kind: "item_bucket",
      },
      // An ordinary, non-family-wide collection the caller also holds a key
      // for — must be filtered out entirely.
      {
        id: "col-personal",
        enc_name: "n",
        created_at: "t",
        access_level: "edit",
        sealed_key: "sealed-personal",
        family_wide_kind: null,
      },
    ]);
    mockUnsealCollectionKey.mockImplementation((_identity: unknown, sealed: string) => {
      if (sealed === "sealed-folder") return new FakeCollectionKey(new Uint8Array([1, 1, 1]));
      if (sealed === "sealed-bucket") return new FakeCollectionKey(new Uint8Array([2, 2, 2]));
      throw new Error(`unexpected sealed_key in test: ${sealed}`);
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(201, { id: deriveInviteId(fixedSecret(11)), expires_at: "2026-08-07T00:00:00Z" }),
    );

    const result = await generateInviteLink({ kind: "family" }, "7d", FAKE_UK);

    const createCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const createBody = JSON.parse(createCall[1].body as string) as {
      collection_id: string | null;
      family_wide_keys: Array<{ collection_id: string; access_level: string; wrapped_collection_key: string }>;
    };
    expect(createBody.collection_id).toBeNull();
    expect(createBody.family_wide_keys).toHaveLength(2);
    const byId = Object.fromEntries(createBody.family_wide_keys.map((e) => [e.collection_id, e]));
    // access_level is the collection's OWN caller-held level, never
    // hardcoded to "read" — the folder entry proves this (it's "edit").
    expect(byId["col-folder"].access_level).toBe("edit");
    expect(byId["col-bucket"].access_level).toBe("read");
    expect(byId["col-personal"]).toBeUndefined();

    // wrapped_collection_key is a REAL channel.wrapCollectionKey output —
    // round-trips via the same channel reconstructed from the url fragment.
    const url = new URL(result.url);
    const fragmentSecret = base64UrlDecode(url.hash.slice(1));
    const channel = FakeInviteChannel.fromSecret(fragmentSecret);
    const unwrappedFolder = channel.unwrapCollectionKey(byId["col-folder"].wrapped_collection_key);
    expect(Array.from(unwrappedFolder.bytes)).toEqual([1, 1, 1]);
    const unwrappedBucket = channel.unwrapCollectionKey(byId["col-bucket"].wrapped_collection_key);
    expect(Array.from(unwrappedBucket.bytes)).toEqual([2, 2, 2]);
  });

  it("zero family-wide collections: family_wide_keys is [] -- byte-identical to pre-30-07 behavior (30-07)", async () => {
    const secret = fixedSecret(13);
    mockGenerateInviteSecret.mockReturnValue(secret);
    mockListCollections.mockResolvedValue([]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(201, { id: deriveInviteId(fixedSecret(13)), expires_at: "2026-08-07T00:00:00Z" }),
    );

    await generateInviteLink({ kind: "family" }, "7d", FAKE_UK);

    const createCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const createBody = JSON.parse(createCall[1].body as string) as { family_wide_keys: unknown[] };
    expect(createBody.family_wide_keys).toEqual([]);
  });

  it("collection-scoped invite ALSO folds in family-wide keys when the caller holds them -- additive, never mutually exclusive (30-07)", async () => {
    const secret = fixedSecret(17);
    mockGenerateInviteSecret.mockReturnValue(secret);
    const explicitBytes = new Uint8Array([4, 5, 6]);
    mockGetCollection.mockResolvedValue({ sealed_key: "sealed-explicit" });
    mockListCollections.mockResolvedValue([
      {
        id: "col-fw",
        enc_name: "n",
        created_at: "t",
        access_level: "edit",
        sealed_key: "sealed-fw",
        family_wide_kind: "folder",
      },
    ]);
    mockUnsealCollectionKey.mockImplementation((_identity: unknown, sealed: string) => {
      if (sealed === "sealed-explicit") return new FakeCollectionKey(explicitBytes);
      if (sealed === "sealed-fw") return new FakeCollectionKey(new Uint8Array([9, 9, 9]));
      throw new Error(`unexpected sealed_key in test: ${sealed}`);
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(201, { id: deriveInviteId(fixedSecret(17)), expires_at: "2026-08-07T00:00:00Z" }),
    );

    await generateInviteLink(
      { kind: "collection", collectionId: "col-explicit", accessLevel: "edit" },
      "1h",
      FAKE_UK,
    );

    const createCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const createBody = JSON.parse(createCall[1].body as string) as {
      collection_id: string;
      wrapped_collection_key: string;
      family_wide_keys: Array<{ collection_id: string }>;
    };
    expect(createBody.collection_id).toBe("col-explicit");
    expect(createBody.wrapped_collection_key).toBeTruthy();
    expect(createBody.family_wide_keys).toHaveLength(1);
    expect(createBody.family_wide_keys[0].collection_id).toBe("col-fw");
  });
});

describe("fetchInviteMetadataFlow / redeemInviteFlow", () => {
  it("both derive the SAME invite_proof from the fragment and send it to every network call", async () => {
    const secret = fixedSecret(9);
    const inviteId = deriveInviteId(fixedSecret(9));
    const fragment = base64UrlEncode(secret);
    const expectedProof = base64Encode(deriveProofForRedemption(fixedSecret(9)));

    const metadataBody = {
      inviter_email: "owner@example.com",
      family_name: "The Family",
      inviter_fingerprint: null,
      collection_id: null,
      wrapped_collection_key: null,
    };

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse(200, metadataBody)) // fetchInviteMetadataFlow's own call
      .mockResolvedValueOnce(jsonResponse(200, metadataBody)) // redeemInviteFlow's internal metadata call
      .mockResolvedValueOnce(jsonResponse(200, { already_member: false })); // redeemInviteFlow's accept call

    const metadata = await fetchInviteMetadataFlow(inviteId, fragment);
    expect(metadata.family_name).toBe("The Family");

    const redeemResult = await redeemInviteFlow(inviteId, fragment, FAKE_UK);
    expect(redeemResult.alreadyMember).toBe(false);

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const proofFromCall = (i: number) => (JSON.parse(calls[i][1].body as string) as { invite_proof: string }).invite_proof;

    expect(proofFromCall(0)).toBe(expectedProof);
    expect(proofFromCall(1)).toBe(expectedProof);
    expect(proofFromCall(2)).toBe(expectedProof);
  });

  it("fetchInviteMetadataFlow throws before any fetch call when the fragment doesn't match the path invite_id", async () => {
    const secret = fixedSecret(1);
    const fragment = base64UrlEncode(secret);

    await expect(fetchInviteMetadataFlow("some-other-invite-id", fragment)).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("redeemInviteFlow throws before any fetch call when the fragment doesn't match the path invite_id", async () => {
    const secret = fixedSecret(1);
    const fragment = base64UrlEncode(secret);

    await expect(redeemInviteFlow("some-other-invite-id", fragment, FAKE_UK)).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
