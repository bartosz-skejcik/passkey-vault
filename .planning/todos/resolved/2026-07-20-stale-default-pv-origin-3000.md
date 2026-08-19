---
created: 2026-07-20T20:20:00.000Z
title: Stale default PV_ORIGIN (localhost:3000) causes silent InvalidRPOrigin
area: api
resolves_phase: 19
files:
  - crates/pv-server/src/config.rs
---

## Problem

`Config::from_env()` defaults `rp_origin` to `http://localhost:3000` (pre-Phase-7 Next dev port), while the documented serving convention is `http://localhost:8620`. A bare `cargo run -p pv-server` therefore boots fine but silently rejects EVERY WebAuthn ceremony with `InvalidRPOrigin` — hit live 2026-07-20 (orchestrator started the dev server without PV_ORIGIN; Bartek couldn't add a passkey or sign in with one; log showed 8 InvalidRPOrigin warnings over 90 min before diagnosis).

## Solution

Either change the default to `http://localhost:8620` (matching PV_ADDR's default port) or make `Config::validate()` fail-loud when PV_ORIGIN is unset (mirroring the Phase-7 fail-loud posture for malformed values). Also consider logging the effective rp_id/rp_origin at boot INFO so a mismatch is visible in the first screenful. Natural home: Phase 19 (server hardening).

---

**RESOLVED 2026-08-19 (backlog sweep, commit `9aa5404`):** default changed to `http://localhost:8620`
and the effective rp_id/rp_origin is logged at boot INFO before pool/webauthn construction. Unit test
`from_env_default_rp_origin_matches_pv_addrs_default_port` added, falsification-proven (reverting the
default turns it red with left: :3000 / right: :8620).
