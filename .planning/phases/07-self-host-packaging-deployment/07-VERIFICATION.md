---
phase: 07-self-host-packaging-deployment
verified: 2026-07-14T00:00:00Z
status: passed_with_concerns
score: 3/3 success criteria verified by code inspection (Docker-daemon E2E human_needed)
behavior_unverified: 0
overrides_applied: 0
requirements: [DEPLOY-01, DEPLOY-02]
must_haves:
  - id: SC1
    text: "One Docker image serves pv-server binary + static Next.js export on one port; SQLite on a persisted named volume surviving compose down/up."
    status: verified_by_inspection
    evidence: "Dockerfile 3-stage (rust-builder compiles REAL pv-core+pv-wasm, only pv-server manifest-stubbed; runtime = debian:bookworm-slim, no cargo/node/npm/rustc); ENV PV_ADDR=0.0.0.0:8620, ENV PV_STATIC_DIR=/app/static, ENV PV_DB_URL=sqlite:///data/pv.db, VOLUME /data, EXPOSE 8620, single ENTRYPOINT [/app/pv-server]. routes/mod.rs router() serves API + static via fallback_service on one port. docker-compose.yml uses named volume pv_data:/data (survives down/up)."
  - id: SC2
    text: "Misconfig fails loudly: Config::validate() rejects incoherent PV_RP_ID/PV_ORIGIN with a specific actionable error, called from main() BEFORE DB connect / Webauthn build (DEPLOY-02)."
    status: verified
    evidence: "config.rs validate() decision table: invalid-URL, missing-host, non-https, rp_id!=host&&!parent — each bails naming the offending value. main.rs L16-20: from_env()? -> validate()? BEFORE build_pool()/build_webauthn(). 8 decision-table unit tests present + suite green + live runtime UAT proven (loud fails + graceful static degradation)."
  - id: SC3
    text: "docs/SELF-HOSTING.md; nginx + Caddy forward WS Upgrade/Connection for /api/sync/ws AND strip session bearer token from access-log query string (closes Phase 5 WR-02 proxy side); scripts/verify-container.sh proves container E2E."
    status: verified_by_inspection
    evidence: "nginx.conf.example: map $http_upgrade + proxy_http_version 1.1 + Upgrade/Connection scoped to /api/sync/ws; log_format sync_ws_redacted logs $uri only (drops ?token=), scoped to that location. Caddyfile.example: reverse_proxy auto WS + log filter 'query { delete token }'. Both cross-reference main.rs make_span WR-02 doc comment. SELF-HOSTING.md complete (quickstart, env table, validate() rationale keyed to error strings, backup/restore incl. -wal/-shm, troubleshooting, E2E). verify-container.sh registers+logs in for a REAL session token before WS assertion, asserts 101 upgrade + absence of token= in each proxy log."
human_needed:
  - test: "docker build -t pv-server-test . && docker run --rm pv-server-test sh -c 'which cargo node npm rustc' (all must be not-found)"
    expected: "Image builds; runtime stage contains no build toolchain; WASM has real crypto exports."
    why_human: "Docker daemon unavailable in this environment."
  - test: "cp .env.example .env && docker compose up -d && curl -sf localhost:8620/healthz && docker compose down && docker compose up -d && curl -sf localhost:8620/healthz"
    expected: "healthz OK before and after a full down/up recreation — SQLite in pv_data volume survives."
    why_human: "Docker daemon unavailable in this environment."
  - test: "bash scripts/verify-container.sh"
    expected: "Exit 0; nginx-test + caddy-test each: HTTPS healthz 200, WS upgrade 101 with real token, no token= in access log."
    why_human: "Requires Docker + nginx + caddy binaries (unavailable here)."
  - test: "dockerized nginx -t / caddy validate on deploy/*.example"
    expected: "Both reference configs validate clean."
    why_human: "Requires nginx/caddy binaries (unavailable here)."
  - test: "docker stop <container> SIGTERM graceful-shutdown timing"
    expected: "Exits within a few seconds, not the 10s SIGKILL grace timeout."
    why_human: "Signal delivery to a running container not unit-testable; Docker unavailable."
  - test: "Playwright-UAT full passkey register + PRF unlock + sync WS behind nginx AND caddy"
    expected: "Ceremony completes through each proxy; sync WS reconnects after a brief network drop."
    why_human: "Browser-driven WebAuthn ceremony cannot be scripted with curl/websocat."
---

# Phase 7: Self-Host Packaging & Deployment — Verification Report

**Phase Goal:** Ship as one Docker container that fails loudly, not mysteriously, when misconfigured.
**Requirements:** DEPLOY-01, DEPLOY-02
**Verified:** 2026-07-14 (git HEAD 2db71b6)
**Status:** passed_with_concerns
**Re-verification:** No — initial verification

## Goal Achievement

### Success Criteria (Observable Truths)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | One image serves binary + static export on one port; SQLite on persisted named volume surviving down/up | VERIFIED (inspection) | Dockerfile + router() + docker-compose.yml — see below |
| SC2 | Config::validate() rejects incoherent PV_RP_ID/PV_ORIGIN with specific actionable error, called BEFORE DB/Webauthn | VERIFIED | config.rs + main.rs ordering + 8 unit tests + live UAT |
| SC3 | Docs + nginx/Caddy WS-forward + token-strip; verify-container.sh proves E2E | VERIFIED (inspection) | SELF-HOSTING.md + deploy/*.example + verify-container.sh |

**Score:** 3/3 criteria satisfied by code inspection. The only unverified elements are Docker-daemon-dependent E2E runs (correctly enumerated human_needed).

### SC1 — Single image, single port, persisted volume (DEPLOY-01)

- `Dockerfile` is a genuine 3-stage build. Stage 1 copies the **real** `crates/pv-core/` and `crates/pv-wasm/` trees in full and runs `build-wasm.sh` against them (comments at L28-44 explicitly explain only `pv-server` is manifest-stubbed for a cache split — pv-core/pv-wasm are never stubbed, so the shipped WASM carries real crypto exports; this was the round-2 fix and it is correct in the current file).
- Runtime stage is `debian:bookworm-slim` and copies only `/app/pv-server` + `/app/static`. No `cargo`/`node`/`npm`/`rustc` are installed in the runtime stage (only `wget` for HEALTHCHECK).
- `ENV PV_ADDR=0.0.0.0:8620` (L132), `ENV PV_STATIC_DIR=/app/static` (L124), `ENV PV_DB_URL=sqlite:///data/pv.db` (L138), `VOLUME /data` (L143), `EXPOSE 8620`, single `ENTRYPOINT ["/app/pv-server"]`.
- `routes/mod.rs::router()` serves `/healthz`, all `/api/*`, and the static export on one router via `api.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index.html)))`. The deliberate `.fallback(...)` (not `.not_found_service(...)`) deviation is present and documented at L58-67 — it preserves the served file's natural 200 for SPA client routes; the deviation is corroborated by `router_static_fallback.rs::unmatched_path_serves_index_html_spa_fallback` asserting `StatusCode::OK`.
- `docker-compose.yml` maps `8620:8620`, mounts the **named** volume `pv_data:/data` (declared under top-level `volumes:`), so data survives `compose down && up` (only `--volumes` would remove it).
- Graceful degradation when no static dir: `router()` logs `WARN "PV_STATIC_DIR not set or not a directory — serving API only"` and returns the API-only router (no panic). Confirmed by test `missing_static_dir_degrades_to_api_only_without_panic` and by live UAT.

### SC2 — Fail-loud misconfig, correct ordering (DEPLOY-02)

- `config.rs::validate()` (L48-89) implements the decision table: localhost pair exempt; non-localhost then requires (a) parseable absolute URL with host, (b) `https` scheme, (c) `rp_id == host` or `host.ends_with(".{rp_id}")`. Each failure `bail!`s naming the offending `PV_ORIGIN`/`PV_RP_ID` value with actionable guidance.
- `main.rs` L16-20: `Config::from_env()?` → `cfg.validate()?` → **then** `build_pool()` → `build_webauthn()`. Validation strictly precedes any DB connect or Webauthn build.
- 8 decision-table unit tests in `config.rs mod tests` cover localhost exception, nonsense-origin-with-localhost-rp_id skip, 127.0.0.1 origin skip, missing scheme, http-not-https, host mismatch, parent-domain OK, exact-match OK.
- Live runtime UAT (provided, trusted): incoherent pairs fail loudly naming both values; coherent pair boots to "listening"; missing PV_STATIC_DIR logs WARN and does not panic.
- SIGTERM: `shutdown_signal()` (L55-77) selects over both `ctrl_c()` and a unix SIGTERM handler, wired into `axum::serve(...).with_graceful_shutdown(...)`. Present and correct by inspection; delivery *timing* is human_needed.

### SC3 — Docs + reverse-proxy WR-02 closure + E2E gate

- `deploy/nginx.conf.example`: full top-level config (validates standalone via `nginx -t`). `map $http_upgrade $connection_upgrade` + `proxy_http_version 1.1` + `Upgrade`/`Connection` headers scoped to the `/api/sync/ws` location (SC3 WS-forward requirement met; nginx needs these explicitly). `log_format sync_ws_redacted` logs `$uri` (path only, query string dropped) and is applied via `access_log ... sync_ws_redacted;` **inside** the `/api/sync/ws` location — so the live `?token=...` never reaches disk. Cross-references `main.rs make_span` WR-02.
- `deploy/Caddyfile.example`: `reverse_proxy pv-server:8620` (auto WS upgrade) + `log { format filter { fields { uri query { delete token } } } }` stripping just the `token` query key. Cross-references the same WR-02 doc comment. No `tls internal` baked into the shipped file (real ACME) — the test-only `tls internal` derivative is generated by the script, not committed.
- Both proxy files literally strip the session token from their own `/api/sync/ws` access-log output — the mandatory WR-02 content obligation is satisfied in both, closing the Phase-5 WR-02 gap on the proxy side.
- `scripts/verify-container.sh`: builds the image via the compose overlay, waits on a bounded healthz retry loop (no blind sleep), then **registers + logs in a throwaway account to obtain a REAL session token** before any WS assertion (comment + code L97-137 explicitly note the empty sessions table rejects placeholder tokens with 401 pre-upgrade). For each of nginx-test and caddy-test it asserts HTTPS healthz 200, a 101 WS upgrade using the real token, and `grep -q 'token='` **absence** in that proxy's access log. Trap-based cleanup on all exit paths. Neither shipped example file is mutated.
- `docker-compose.proxy-test.yml`: overlay-only (documented as never standalone); mounts the two example configs and script-generated disposable TLS material; exposes nginx on 8621, caddy on 8622.
- `docs/SELF-HOSTING.md` (Polish, per convention): quickstart, full env-var table matching config.rs/main.rs, a dedicated section on why an incoherent PV_RP_ID/PV_ORIGIN blocks startup (keyed to the exact `validate()` error strings), backup/restore that correctly includes the `-wal`/`-shm` sidecar files, a troubleshooting table mapping symptoms to `Config::validate()` errors, and both automated (`verify-container.sh`) and manual (Playwright-UAT) E2E sections.

### Supporting artifact — WAL persistence (DEPLOY-01)

`lib.rs::build_pool()` opens SQLite with `create_if_missing(true)`, `journal_mode(Wal)`, `busy_timeout(5s)`, `max_connections(8)`, runs migrations. Test `build_pool_enables_wal_journal_mode` asserts `PRAGMA journal_mode == wal` against a real temp file. Underpins the volume-persistence and concurrency guarantees.

### Anti-Patterns Found

None blocking. No unreferenced `TBD`/`FIXME`/`XXX` debt markers in the phase's shipped files. The `.fallback()` vs `.not_found_service()` choice and the `pv-server` manifest-only stub are deliberate, documented deviations (not stubs of shipped behavior) and are corroborated by tests/comments.

### Concerns (non-blocking)

1. **Docker-daemon E2E not executable here.** All container/proxy validation (`docker build`, `docker compose` up/down persistence, `scripts/verify-container.sh`, `nginx -t`, `caddy validate`, SIGTERM timing, Playwright ceremony) requires binaries absent from this environment. Each is enumerated in `07-VALIDATION.md`'s Manual-Only table with exact commands and mirrored into this report's `human_needed`. These are the sole open items — everything code-inspectable is confirmed correct.
2. **Missing SUMMARYs for plans 07-02 and 07-03.** Only `07-01-SUMMARY.md` exists; `07-02` (Docker packaging) and `07-03` (reverse-proxy + container E2E) have PLANs but no SUMMARY. This is a documentation/traceability gap only — every artifact those two plans were to produce (Dockerfile, docker-compose.yml, docker-compose.proxy-test.yml, .dockerignore, deploy/nginx.conf.example, deploy/Caddyfile.example, scripts/verify-container.sh, docs/SELF-HOSTING.md) exists at HEAD, is substantive, and is correct by inspection. Recommend generating the two missing SUMMARYs for audit completeness; it does not affect goal achievement.

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| DEPLOY-01 (single container, one port, persisted volume, static+API, proxy configs, E2E gate) | SATISFIED (inspection; container E2E human_needed) | Dockerfile, compose, router() fallback, build_pool WAL, deploy/*.example, verify-container.sh, SELF-HOSTING.md |
| DEPLOY-02 (fail-loud misconfig before DB/Webauthn) | SATISFIED | config.rs validate() + main.rs ordering + 8 tests + live UAT |

---

_Verified: 2026-07-14 (HEAD 2db71b6)_
_Verifier: Claude (gsd-verifier, Opus 4.8)_
