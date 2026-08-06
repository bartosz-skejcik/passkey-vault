// Phase 26, Plan 01, Task 2 — real-WASM proof of the CLIENT half of the
// WR-09 fix (A-1, 26-CONTEXT.md): the client mints the collection's `id`
// BEFORE encrypting `enc_name`, whose AAD is bound to that exact id, then
// sends both to the server. This file follows the IDENTICAL shape every
// other `*.real-wasm.test.ts` in this codebase uses (see
// `web/src/lib/invite/crypto.real-wasm.test.ts`'s own header comment, and
// this plan's "Test-tiering decision" note): real WASM crypto calls with
// ONLY `global.fetch` stubbed — never `vi.mock("@/lib/crypto", ...)`. No
// live pv-server is spun up here; Task 1's Rust tests prove the SERVER half
// of this same contract, and Plan 26-13's live Playwright run proves both
// halves together against a real running server.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  initCrypto,
  WasmCollectionKey,
  WasmIdentityKey,
  WasmIdentityPublicKey,
  sealCollectionKey,
  unsealCollectionKey,
  encryptItemForCollection,
  decryptItemForCollection,
} from "@/lib/crypto";
import { ApiClientError } from "@/lib/auth/api";
import { createCollection, type ItemRow } from "./api";

// Typecheck-level proof (not a runtime assertion): if `collection_id` were
// ever removed from `ItemRow`, this literal fixture fails to compile under
// `npx tsc --noEmit` — the wire field Task 1 added server-side has a
// client-side type to match.
const _itemRowIncludesCollectionId: ItemRow = {
  id: "item-1",
  enc_key: "{}",
  enc_data: "{}",
  revision: 1,
  updated_at: "2026-08-06T00:00:00Z",
  last_used_at: null,
  is_shared: false,
  last_editor_email: null,
  collection_id: null,
};
void _itemRowIncludesCollectionId;

// Collections carry no revision column of their own — a collection's own
// `enc_name` is always encrypted/decrypted at revision 1 (matches
// `RemoveMemberDialog.tsx`'s own `COLLECTION_NAME_REVISION` precedent).
const COLLECTION_NAME_REVISION = 1;

beforeAll(async () => {
  // `initCrypto()` hardcodes the fetch path "/wasm/pv_wasm_bg.wasm" — stub
  // global fetch to serve the REAL compiled binary's bytes directly off
  // disk. This branch is unchanged from every other `*.real-wasm.test.ts`
  // file's own `beforeAll` (see `invite/crypto.real-wasm.test.ts`); the
  // SECOND branch (intercepting `/api/vault/collections`) is added per-test
  // below via `vi.stubGlobal`-free direct reassignment, since only THIS
  // file's tests need it and other real-wasm test files must not be
  // affected by a shared fetch stub.
  const wasmPath = path.join(process.cwd(), "public", "wasm", "pv_wasm_bg.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("pv_wasm_bg.wasm")) {
      return new Response(wasmBytes, { status: 200, headers: { "Content-Type": "application/wasm" } });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  await initCrypto();
});

describe("createCollection: real-WASM round trip proves the WR-09 fix's client half", () => {
  it("mint id -> encrypt enc_name bound to it -> POST -> mocked echo response -> decrypt back to the original plaintext", async () => {
    // Mint the id BEFORE encrypting — this ordering is the entire point of
    // the WR-09 fix (A-1). A real client uses `crypto.randomUUID()`; a
    // fixed, valid-shaped literal is used here for a deterministic
    // assertion further down.
    const clientMintedId = "d3f1c2b4-5e6a-4b7c-8d9e-0f1a2b3c4d5e";

    const ck = WasmCollectionKey.generate();
    const originalName = "Real WASM Round Trip Folder";
    let encName: string;
    try {
      // AAD bound to `clientMintedId` for BOTH the collection-scope
      // component and the item-id component, revision 1 — the exact call
      // shape `RemoveMemberDialog.tsx`'s `resolveFolder` already documents
      // as "the ONLY correct way to decrypt a collection's own name".
      encName = encryptItemForCollection(
        ck,
        JSON.stringify({ name: originalName }),
        clientMintedId,
        clientMintedId,
        COLLECTION_NAME_REVISION,
      );

      const identityKey = WasmIdentityKey.generate();
      let sealedKey: string;
      try {
        const ownPublicKey = WasmIdentityPublicKey.fromBytes(identityKey.publicKeyBytes());
        sealedKey = sealCollectionKey(ownPublicKey, ck);
      } finally {
        // (WasmIdentityPublicKey carries no `.free?.()` in this codebase's
        // own usage elsewhere — e.g. `rekey.ts` — since it wraps public,
        // non-secret material; only the SECRET-holding handles below are
        // freed.)
      }

      const originalFetch = global.fetch;
      global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/vault/collections") && init?.method === "POST") {
          const sentBody = JSON.parse(init.body as string) as {
            id: string;
            enc_name: string;
            sealed_key: string;
          };
          // Mirrors EXACTLY the echo contract Task 1's Rust tests already
          // prove the real server implements: id/enc_name/sealed_key
          // identical to what was sent, a hardcoded 'edit' access_level (the
          // creator is always a full editor of their own creation), and a
          // literal created_at.
          return new Response(
            JSON.stringify({
              id: sentBody.id,
              enc_name: sentBody.enc_name,
              sealed_key: sentBody.sealed_key,
              access_level: "edit",
              created_at: "2026-08-06T00:00:00Z",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      const response = await createCollection(clientMintedId, encName, sealedKey);

      expect(response.id).toBe(clientMintedId);
      expect(response.enc_name).toBe(encName);
      expect(response.sealed_key).toBe(sealedKey);
      expect(response.access_level).toBe("edit");

      // Decrypt the response's OWN enc_name back — this is the proof: if the
      // WR-09 defect were still present (server-minted id diverging from the
      // AAD-bound id), this decrypt would fail with an AEAD error, not
      // silently return wrong plaintext.
      const recoveredCk = unsealCollectionKey(identityKey, response.sealed_key as string);
      try {
        const plaintext = decryptItemForCollection(
          recoveredCk,
          response.enc_name,
          response.id,
          response.id,
          COLLECTION_NAME_REVISION,
        );
        const parsed = JSON.parse(plaintext) as { name: string };
        expect(parsed.name).toBe(originalName);
      } finally {
        recoveredCk.free?.();
      }

      identityKey.free?.();
    } finally {
      ck.free?.();
    }
  });

  it("surfaces a 409 response as an ApiClientError with status 409 (server-half proven separately by Task 1's Rust tests)", async () => {
    const originalFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/vault/collections") && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "a collection with this id already exists" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    await expect(createCollection("d3f1c2b4-5e6a-4b7c-8d9e-0f1a2b3c4d5e", "enc-name", "sealed-key")).rejects.toSatisfy(
      (err: unknown) => err instanceof ApiClientError && err.status === 409,
    );
  });
});
