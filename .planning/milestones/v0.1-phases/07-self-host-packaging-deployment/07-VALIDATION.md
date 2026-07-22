---
phase: 7
slug: self-host-packaging-deployment
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-14
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 07-RESEARCH.md § Validation Architecture and the 3-plan/10-task breakdown (07-01 server-readiness, 07-02 Docker packaging, 07-03 reverse-proxy + container E2E).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (Rust)** | `cargo test` (native target) — `pv-server`'s existing `mod tests` convention, extended to `config.rs`; new integration test `crates/pv-server/tests/router_static_fallback.rs` |
| **Framework (container/E2E)** | New this phase — `scripts/verify-container.sh` + a `docker-compose.proxy-test.yml` overlay (dockerized nginx **and** Caddy fronting the packaged image). No prior container-test infra in this repo. |
| **Config file** | Cargo.toml (workspace); `Dockerfile`; `docker-compose.yml`; `deploy/*.example` |
| **Quick run command (Rust)** | `cargo test -p pv-server config::` / `cargo test -p pv-server --test router_static_fallback` |
| **Full suite command** | `cargo test --workspace` + `docker build -t pv-server-test .` + `scripts/verify-container.sh` |
| **Estimated runtime** | Rust suite ~60s; container build + E2E ~3–6 min (Docker-dependent) |

---

## Sampling Rate

- **After every task commit:** targeted `cargo test -p pv-server <module>::` for the touched module (or the container-level `<automated>` command for Docker/proxy tasks).
- **After every plan wave:** `cargo test --workspace`; from Wave 2 onward, one container-level smoke run (`docker build` + `docker compose up` healthz) once the image exists.
- **Phase gate (before `/gsd-verify-work`):** full `cargo test --workspace` green, `docker build .` succeeds, and at least one proxy (nginx or Caddy) verified end-to-end via `scripts/verify-container.sh`, per this project's Playwright-UAT convention for the full passkey ceremony.
- **Max feedback latency:** 180 seconds for the Rust surface; container/E2E is a wave/phase-gate sample, not a per-commit one.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | DEPLOY-02 | misconfig-silent-boot | `Config::validate()` 8-row decision table: localhost exception passes untouched; non-localhost missing-scheme / http-not-https / rp_id-vs-origin-host mismatch each fail with a named-value actionable error | unit (Rust, TDD) | `cargo test -p pv-server config::` | N/A (created by task) | ⬜ pending |
| 07-01-02 | 01 | 1 | DEPLOY-01 | data-loss-on-concurrency | SQLite opened with WAL + `busy_timeout` (no `database is locked` under concurrent writes); existing lib tests stay green | unit/smoke (Rust) | `cargo test -p pv-server --lib` | N/A (created by task) | ⬜ pending |
| 07-01-03 | 01 | 1 | DEPLOY-01 | — | `router(state, static_dir)` serves `index.html` SPA fallback for unmatched paths when a static dir exists, keeps all `/api/*` routes, and degrades to API-only with a warning (never panics) when the dir is absent; `static_dir: None` regression-safe | integration (Rust, TDD) | `cargo test -p pv-server --test router_static_fallback && cargo test -p pv-server --tests` | N/A (created by task) | ⬜ pending |
| 07-01-04 | 01 | 1 | DEPLOY-01, DEPLOY-02 | fail-fast-ordering | `cfg.validate()?` called immediately after `Config::from_env()?`, before `build_pool`/`build_webauthn`; SIGTERM graceful shutdown added to `shutdown_signal` (SIGINT+SIGTERM); full workspace green | integration (Rust) + manual (signal timing) | `cargo build -p pv-server && cargo test --workspace` | N/A (created by task) | ⬜ pending |
| 07-02-01 | 02 | 2 | DEPLOY-01 | build-toolchain-leak / empty-crate-ship | 3-stage Dockerfile builds REAL `pv-core`/`pv-wasm` source (only `pv-server` manifest-stubbed for cache split), ships binary + static export, no cargo/node/npm/rustc in runtime, `wget` HEALTHCHECK, `ENV PV_ADDR=0.0.0.0:8620`, `VOLUME /data` | scripted E2E (Docker) | `docker build -t pv-server-test . && docker run --rm pv-server-test sh -c 'which cargo node npm rustc'` (must all be not-found) | N/A (created by task) | ⬜ pending |
| 07-02-02 | 02 | 2 | DEPLOY-01 | volume-persistence | `docker compose config` parses for default + customized `.env`; `docker compose up` reachable on host; SQLite in named `pv_data` volume survives a full `down && up` recreation (not just restart) | scripted E2E (Docker) | `docker compose config` + manual `up/down/up` healthz persistence check | N/A (created by task) | ⬜ pending |
| 07-02-03 | 02 | 2 | DEPLOY-01, DEPLOY-02 | operator-confusion | `docs/SELF-HOSTING.md` (Polish): quickstart, env table, why an incoherent `PV_RP_ID`/`PV_ORIGIN` is rejected (keyed to `Config::validate()` error strings), backup/restore, troubleshooting | doc review (manual) | — (prose; correctness anchored to Task 07-01-01 error strings) | N/A (created by task) | ⬜ pending |
| 07-03-01 | 03 | 3 | DEPLOY-01 | WR-02 proxy-log-token-leak | `deploy/nginx.conf.example`: `map $http_upgrade` + `proxy_http_version 1.1` + Upgrade/Connection triple scoped to `/api/sync/ws`; a `/api/sync/ws` `log_format` logging `$uri` only (query string dropped) — closes Phase 5 WR-02 on the proxy side | scripted validation (dockerized `nginx -t`) | `docker run --rm -v ...:... nginx:1-alpine nginx -t` (with a throwaway self-signed cert at the referenced paths) | N/A (created by task) | ⬜ pending |
| 07-03-02 | 03 | 3 | DEPLOY-01 | WR-02 proxy-log-token-leak | `deploy/Caddyfile.example`: `reverse_proxy` automatic WS upgrade + `log { format filter { ... query { delete token } } }` stripping the session token from access logs; MEDIUM-confidence directive nesting corrected against a real `caddy validate` | scripted validation (dockerized `caddy validate`) | `docker run --rm -v ...:... caddy:2 caddy validate --config ...` | N/A (created by task) | ⬜ pending |
| 07-03-03 | 03 | 3 | DEPLOY-01 | end-to-end-transport | `scripts/verify-container.sh`: real pass/fail gate — builds image, fronts it with dockerized nginx AND Caddy via `docker-compose.proxy-test.yml`, registers+logs in for a REAL session token, asserts HTTPS `/healthz`, a completed WS upgrade handshake over TLS, and absence of `token=` in each proxy's access log; trap-based cleanup | scripted E2E (Docker) | `scripts/verify-container.sh` | N/A (created by task) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `crates/pv-server/src/config.rs`'s `mod tests` — `Config::validate()` decision table (localhost exception, missing scheme, http-not-https, rp_id/origin host mismatch), mirroring `lib.rs`'s existing `build_webauthn_*` test pair (delivered by Plan 07-01 Task 1)
- [ ] `crates/pv-server/tests/router_static_fallback.rs` — SPA fallback behavior with a real temp directory standing in for `web/out/`, plus API-route coexistence and `static_dir: None` regression (delivered by Plan 07-01 Task 3)
- [ ] `crates/pv-server/src/main.rs` — extend shutdown handling to SIGTERM; signal delivery itself is verified manually via `docker stop` timing (documented in the task summary, not a forced unit test) (delivered by Plan 07-01 Task 4)
- [ ] `scripts/verify-container.sh` + `docker-compose.proxy-test.yml` — first container-level E2E test infrastructure in this repo; the shape (scripted, not manual-only) is decided by Plan 07-03 Task 3

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `docker build .` / `docker compose up`+`down`+`up` persistence / `scripts/verify-container.sh` full run | DEPLOY-01 | Requires a Docker daemon. **Docker is unavailable in the current autonomous-run environment** — these `<automated>` commands are real and scripted but cannot execute here; they are marked human_needed at execution time with exact commands, not skipped. | Run on a Docker-capable host: `docker build -t pv-server-test .`; `cp .env.example .env && docker compose up -d && curl -sf localhost:8620/healthz && docker compose down && docker compose up -d && curl -sf localhost:8620/healthz`; `bash scripts/verify-container.sh` (expects exit 0 + "token= absent" assertions). |
| Full passkey registration/login + `/api/sync/ws` behind a real proxy | DEPLOY-01 (proxy criterion #3) | A browser-driven WebAuthn ceremony can't be scripted with curl/websocat — needs a browser + authenticator. The script proves the HTTP/WS transport+logging contract; the ceremony is UAT. | Playwright-UAT against the proxied HTTPS URL (this project's UAT convention): register + unlock + trigger a sync, confirm the reconnecting/WS path works through nginx and Caddy. |
| SIGTERM graceful-shutdown timing | DEPLOY-01 | Signal delivery to a process is not meaningfully unit-testable inside `cargo test`'s own harness. | `docker stop <container>` should exit within a few seconds, not hit the 10s SIGKILL timeout. |
| `caddy validate` / `nginx -t` on the reference configs | DEPLOY-01 | Requires the real nginx/Caddy binaries (dockerized). Same Docker-unavailability caveat as above. | Run the per-task `<automated>` validation commands on a Docker-capable host before shipping the examples as "tested." |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (07-02-03 docs task is prose, anchored to Task 07-01-01's error strings; exempt per convention)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (Rust tasks 01-01..01-04 all automated; Docker tasks carry scripted E2E commands)
- [x] Wave 0 covers all MISSING references from the RESEARCH test map (config validate, router static fallback, verify-container.sh)
- [x] No watch-mode flags
- [x] Feedback latency < 180s for the per-commit Rust surface
- [x] `nyquist_compliant: true` set in frontmatter
- [x] **Environment caveat recorded:** Docker/Caddy/nginx E2E is human_needed in this autonomous run (no Docker daemon); Rust-side validation is fully executable here.

**Approval:** approved 2026-07-14 (generated to close the Dimension-8 gate flagged by the Phase-7 plan re-check; validation substance was already embedded in all three plans' per-task `<automated>` blocks and 07-RESEARCH.md's test map — this artifact makes it a standalone contract).
