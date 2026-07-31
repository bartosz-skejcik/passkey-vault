// WR-10 (24-REVIEW.md): every unit test in this repo mocks `@/lib/crypto`
// (including `crypto.test.ts`'s own wholesale mock, `:92-104`), so the REAL
// `WasmInviteChannel` never runs in the unit suite and the
// `base64UrlEncode`/`base64UrlDecode` <-> Rust `URL_SAFE_NO_PAD` agreement is
// asserted only against a JS fake (`deriveInviteId` in `crypto.test.ts`,
// which is a bespoke re-implementation, not the real HKDF derivation). That
// is the same class of blind spot that let CR-02 and WR-02 ship green.
//
// This file is the structural fix, not a per-bug patch: it loads the REAL
// compiled wasm binary (no `vi.mock("@/lib/crypto", ...)` anywhere in this
// file) and proves the actual client-side derivation agrees with Rust's own
// `pv_core::invite::derive_invite_id` for a FIXED, known secret -- a golden
// cross-language vector, not a round-trip against itself.
//
// The golden `EXPECTED_INVITE_ID` below was produced by running Rust code
// directly against the same `FIXED_SECRET` bytes:
//   pv_core::invite::derive_invite_id(&[1,2,...,32]) == "L77NhfrzdiFVqhDF_oZ1fVDyXz2hWo2hPMS-KMiEPW8"
// (computed via a throwaway `cargo run -p pv-core --example` invocation
// during this fix's own verification -- not committed, since it was only a
// vector-generation aid, not a maintained artifact).
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { initCrypto, WasmInviteChannel, generateInviteSecret } from "@/lib/crypto";
import { base64UrlDecode, base64UrlEncode } from "./crypto";

const FIXED_SECRET = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));
const EXPECTED_INVITE_ID = "L77NhfrzdiFVqhDF_oZ1fVDyXz2hWo2hPMS-KMiEPW8";

beforeAll(async () => {
  // `initCrypto()` hardcodes the fetch path "/wasm/pv_wasm_bg.wasm" -- stub
  // global fetch to serve the REAL compiled binary's bytes directly off
  // disk, rather than mocking the crypto module itself away. This is the
  // ONLY thing stubbed in this file; every crypto call below runs the
  // genuine wasm-bindgen bindings.
  const wasmPath = path.join(process.cwd(), "public", "wasm", "pv_wasm_bg.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("pv_wasm_bg.wasm")) {
      return new Response(wasmBytes, { status: 200, headers: { "Content-Type": "application/wasm" } });
    }
    return originalFetch(input);
  }) as typeof fetch;

  await initCrypto();
});

describe("WR-10 structural regression guard: real WASM invite derivation vs. Rust golden vector", () => {
  it("WasmInviteChannel.fromSecret(...).inviteId() matches pv_core::invite::derive_invite_id for the same bytes", () => {
    // `fromSecret` zeroizes its input buffer -- pass a COPY, matching every
    // real call site's own "capture before zeroize" discipline
    // (lib/invite/crypto.ts's own header comment, T-24-12).
    const channel = WasmInviteChannel.fromSecret(Uint8Array.from(FIXED_SECRET));
    try {
      expect(channel.inviteId()).toBe(EXPECTED_INVITE_ID);
    } finally {
      channel.free?.();
    }
  });

  it("the real generateInviteSecret -> base64UrlEncode -> base64UrlDecode round trip reconstructs an identical, real WasmInviteChannel", () => {
    const secret = generateInviteSecret();
    expect(secret).toBeInstanceOf(Uint8Array);
    expect(secret.length).toBe(32);

    const fragment = base64UrlEncode(secret);
    // The fragment must contain no '+'/'/' — it travels in a URL fragment,
    // never STANDARD-alphabet-encoded (this is a REAL encode, not the fake
    // one `crypto.test.ts` asserts against).
    expect(fragment).not.toMatch(/[+/=]/);

    const decoded = base64UrlDecode(fragment);
    const channel = WasmInviteChannel.fromSecret(decoded);
    try {
      // Deterministic: re-deriving from a COPY of the original secret must
      // produce the identical id the real HKDF+base64url path already
      // computed above -- proving the JS-side url-safe transform and the
      // Rust-side derivation agree on a value that was never hardcoded.
      const secondChannel = WasmInviteChannel.fromSecret(Uint8Array.from(secret));
      try {
        expect(channel.inviteId()).toBe(secondChannel.inviteId());
      } finally {
        secondChannel.free?.();
      }
    } finally {
      channel.free?.();
    }
  });
});
