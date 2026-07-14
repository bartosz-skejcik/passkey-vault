---
phase: 07-self-host-packaging-deployment
plan: 02
subsystem: infra
tags: [docker, docker-compose, dockerfile, self-hosting, wasm, nextjs-export, sqlite]

requires:
  - phase: 07-01
    provides: "Config::validate() fail-fast startup errors; router()'s Option<PathBuf> static_dir SPA serving via PV_STATIC_DIR; SQLite WAL + busy_timeout in build_pool; SIGTERM-aware graceful shutdown"
provides:
  - "Dockerfile — 3-stage build (rust-builder → web-builder → debian:bookworm-slim runtime) producing /app/pv-server + /app/static, built from REAL crates/pv-core + crates/pv-wasm source (only crates/pv-server manifest-stubbed for the cache split), no build toolchain surviving into runtime, wget HEALTHCHECK, ENV PV_ADDR=0.0.0.0:8620 / PV_DB_URL=sqlite:///data/pv.db / VOLUME /data defaults"
  - ".dockerignore — excludes target/, node_modules/, build artifacts, and critically .env (distinct from the committed .env.example)"
  - "docker-compose.yml — single pv-server service (build: ., pv_data named volume, wget healthcheck, restart: unless-stopped) with PV_ADDR/PV_DB_URL explicitly mirroring the Dockerfile's baked-in defaults and PV_RP_ID/PV_ORIGIN/PV_SESSION_TTL_HOURS interpolated from .env with localhost-safe fallbacks"
  - ".env.example — documents exactly PV_RP_ID/PV_ORIGIN/PV_SESSION_TTL_HOURS, matching config.rs's real std::env::var(\"PV_...\") names verbatim (no invented PV_PUBLIC_URL alias)"
  - "docs/SELF-HOSTING.md — Polish end-to-end quickstart: docker compose up, env var table, self-hoster-facing Config::validate() decision rules, WAL-aware backup/restore, reverse-proxy forward-reference, troubleshooting table; linked from README.md"
affects: [07-03-reverse-proxy-deployment]

tech-stack:
  added: ["Docker (multi-stage build)", "docker-compose"]
  patterns:
    - "3-stage Docker build cache-split: REAL source copied in full for crates a stage actually compiles (pv-core, pv-wasm — build-wasm.sh binds them via wasm-bindgen), manifest-only stub src/ for a workspace member the stage never builds (pv-server, needed only so the virtual workspace's manifest resolution succeeds) — preserves layer caching without ever silently shipping a broken/exportless WASM artifact"
    - "docker-compose environment block explicitly mirrors the Dockerfile's own baked-in ENV defaults (PV_ADDR, PV_DB_URL) as belt-and-suspenders documentation, rather than relying solely on image-baked values or solely on compose — the same value is asserted in two places on purpose"
    - ".env.example documents only the operator-safe-to-override vars (PV_RP_ID, PV_ORIGIN, PV_SESSION_TTL_HOURS); PV_DB_URL/PV_ADDR/PV_STATIC_DIR are intentionally absent with an explicit comment explaining why overriding them would break the packaged deployment"

key-files:
  created:
    - Dockerfile
    - .dockerignore
    - docker-compose.yml
    - .env.example
    - docs/SELF-HOSTING.md
  modified:
    - README.md

key-decisions:
  - "Stub-manifest treatment applies ONLY to crates/pv-server (the one workspace member this Dockerfile stage never builds) — crates/pv-core and crates/pv-wasm get their real source copied in full before scripts/build-wasm.sh runs, since a stub for either of those would let cargo build 'succeed' against zero real code and wasm-bindgen would silently emit exportless glue"
  - "Runtime stage bakes ENV PV_ADDR=0.0.0.0:8620, overriding config.rs's own 127.0.0.1:8620 dev default — a bare `docker run -p 8620:8620` with no flags would otherwise be unreachable from the host despite the port mapping looking correct"
  - "Runtime stage bakes ENV PV_DB_URL=sqlite:///data/pv.db + VOLUME /data so a bare `docker run -v pv_data:/data` persists by default, without requiring docker-compose.yml as the only source of that value"
  - ".env.example deliberately does not list PV_DB_URL/PV_ADDR/PV_STATIC_DIR as overridable — they're baked directly into docker-compose.yml for the packaged deployment and overriding them (e.g. reverting PV_ADDR to 127.0.0.1:8620) would make the container unreachable"
  - "docs/SELF-HOSTING.md written in Polish, matching docs/ARCHITECTURE.md's register, per this project's established Polish-prose convention for docs"

patterns-established:
  - "Docker build toolchain-leak prevention: runtime stage is a fresh debian:bookworm-slim FROM with only the compiled binary + static assets COPY'd in — no builder-stage packages (cargo/node/npm/rustc) are ever installed into it"
  - "Self-hosting docs cross-reference Config::validate()'s decision rules in self-hoster-facing language (symptom → likely error → fix table) rather than quoting Rust error strings verbatim"

requirements-completed: [DEPLOY-01, DEPLOY-02]

coverage:
  - id: D1
    description: "Dockerfile defines a 3-stage build (rust-builder → web-builder → runtime) where rust-builder copies REAL crates/pv-core + crates/pv-wasm source in full and stubs ONLY crates/pv-server's manifest + empty src/ before running scripts/build-wasm.sh unmodified, then copies the real pv-server tree and runs `cargo build -p pv-server --release`; runtime stage (debian:bookworm-slim) installs only wget, copies /app/pv-server + /app/static, and sets ENV PV_STATIC_DIR=/app/static, ENV PV_ADDR=0.0.0.0:8620, ENV PV_DB_URL=sqlite:///data/pv.db, VOLUME /data, EXPOSE 8620, and a wget-based HEALTHCHECK against /healthz"
    requirement: "DEPLOY-01"
    verification:
      - kind: manual_procedural
        ref: "Direct read of Dockerfile — grep -n 'ENV PV_ADDR\\|ENV PV_DB_URL\\|VOLUME /data\\|HEALTHCHECK' Dockerfile confirms all directives present in the runtime stage; grep -n 'crates/pv-server/src' Dockerfile confirms the stub-src step applies only to crates/pv-server, never crates/pv-core or crates/pv-wasm (both copied in full at step 2, before the stub step)"
        status: pass
    human_judgment: false
  - id: D2
    description: "docker build -t pv-server-test . succeeds from a clean checkout; the runtime image contains no cargo/node/npm/rustc; a bare `docker run -p 8620:8620` (no -e PV_ADDR override) is reachable on the host at /healthz and /; `docker inspect` reaches Health.Status: healthy; a bare `docker run -v pv_data_smoketest:/data` writes pv.db into the named volume with no compose file or extra flags; editing only crates/pv-server/src/routes/ and rebuilding shows the build-wasm.sh RUN layer as CACHED"
    requirement: "DEPLOY-01"
    verification:
      - kind: e2e
        ref: "docker build -t pv-server-test . ; docker run --rm pv-server-test which cargo node npm rustc (expect all nonzero); docker run --rm -d -p 8620:8620 pv-server-test && curl -sf http://127.0.0.1:8620/healthz && curl -sf http://127.0.0.1:8620/; docker run --rm -v pv_data_smoketest:/data pv-server-test (briefly) && docker run --rm -v pv_data_smoketest:/data debian:bookworm-slim ls /data (expect pv.db present); docker inspect --format='{{json .State.Health}}' <container> (expect \"healthy\")"
        status: deferred
    human_judgment: true
    rationale: "Docker is unavailable in this execution environment (documented in commit 0e09c80's own message as DEFERRED, human_needed). The commands above are real and scripted per 07-VALIDATION.md's Manual-Only Verifications table — a human on a Docker-capable host must run them before this deliverable is proven working, not just written."
  - id: D3
    description: "docker-compose.yml defines a single pv-server service (build: ., ports 8620:8620, named volume pv_data:/data, environment block explicitly mirroring the Dockerfile's PV_ADDR/PV_DB_URL defaults plus ${PV_RP_ID:-localhost}/${PV_ORIGIN:-http://localhost:8620}/${PV_SESSION_TTL_HOURS:-168} interpolation, a wget healthcheck mirroring the Dockerfile's own, restart: unless-stopped); .env.example documents exactly PV_RP_ID/PV_ORIGIN/PV_SESSION_TTL_HOURS (no invented PV_PUBLIC_URL alias), each matching an actual std::env::var(\"PV_...\") call in config.rs verbatim, with an explicit comment that PV_DB_URL/PV_ADDR/PV_STATIC_DIR are intentionally not listed"
    requirement: "DEPLOY-02"
    verification:
      - kind: manual_procedural
        ref: "Direct read of docker-compose.yml and .env.example (via git show f52aa3f:.env.example) cross-checked against crates/pv-server/src/config.rs's std::env::var(\"PV_...\") call sites — all five names (PV_RP_ID, PV_ORIGIN, PV_SESSION_TTL_HOURS, PV_DB_URL, PV_ADDR) match verbatim, no invented alias"
        status: pass
    human_judgment: false
  - id: D4
    description: "docker compose config parses cleanly for both an unset .env (localhost defaults) and a customized .env; docker compose up boots pv-server reachable on host port 8620; a full docker compose down && docker compose up (container recreation, not just a process restart) preserves previously-written vault data via the pv_data named volume"
    requirement: "DEPLOY-01"
    verification:
      - kind: e2e
        ref: "docker compose config; cp .env.example .env && docker compose up -d && curl -sf http://127.0.0.1:8620/healthz && docker compose down && docker compose up -d && curl -sf http://127.0.0.1:8620/healthz (register a fixture account + vault item between the two ups to verify data persistence interactively, not just /healthz reachability)"
        status: deferred
    human_judgment: true
    rationale: "Docker is unavailable in this execution environment (documented in commit f52aa3f's own message as DEFERRED, human_needed). A human on a Docker-capable host must run docker compose config/up/down/up and confirm named-volume persistence before this deliverable is proven working."
  - id: D5
    description: "docs/SELF-HOSTING.md (Polish) covers a docker compose up quickstart, an env var table (PV_RP_ID, PV_ORIGIN, PV_SESSION_TTL_HOURS, PV_DB_URL, PV_ADDR, PV_STATIC_DIR — each matching config.rs/main.rs's actual std::env::var(\"PV_...\") calls verbatim), a self-hoster-facing explanation of Config::validate()'s three non-localhost decision rules (full URL with scheme, https required, rp_id must equal or be a parent of origin's host), a WAL-aware backup/restore procedure naming the -wal/-shm sibling files explicitly, and a forward-reference to deploy/ for reverse-proxy configs (not yet written when this plan executed); README.md's Struktura table and a new Self-hosting section link to it"
    requirement: "DEPLOY-02"
    verification:
      - kind: manual_procedural
        ref: "Direct read of docs/SELF-HOSTING.md's Szybki start / Konfiguracja / Wdrożenie za reverse proxy / Backup i restore / Rozwiązywanie problemów sections, and README.md's diff in commit 63a0ad9"
        status: pass
    human_judgment: false

duration: ~15min (commit span 21:00:50–21:02:09; doc-writing and file authoring time not separately timestamped)
completed: 2026-07-14
status: complete
---

# Phase 7 Plan 02: Docker Packaging & Self-Hosting Quickstart Summary

**A 3-stage `Dockerfile` (real `pv-core`/`pv-wasm` compiled from source, only `pv-server` manifest-stubbed for cache-split) producing a single self-contained image, a `docker-compose.yml` reference deployment with a named-volume-persisted SQLite database, and a Polish `docs/SELF-HOSTING.md` quickstart — the packaging half of Phase 7's self-hostable single-container deployment.**

## Performance

- **Duration:** ~15 min (task commits span 21:00:50–21:02:09 on 2026-07-14; exact wall-clock authoring time not separately recorded)
- **Started:** 2026-07-14 (session following 07-01)
- **Completed:** 2026-07-14T21:02:09+02:00 (last task commit, 63a0ad9)
- **Tasks:** 3/3 completed
- **Files modified:** 6 (5 new, 1 modified)

## Accomplishments
- `Dockerfile` — 3-stage build (`rust-builder` → `web-builder` → `debian:bookworm-slim` runtime) compiling REAL `crates/pv-core`/`crates/pv-wasm` source via `scripts/build-wasm.sh`, stubbing ONLY `crates/pv-server`'s manifest for the workspace-resolution cache split, producing `/app/pv-server` + `/app/static` with no build toolchain surviving into the runtime stage — closes DEPLOY-01's buildable-single-container requirement
- `.dockerignore` excludes build artifacts and critically `.env` (distinct from the committed `.env.example`), preventing real secrets from leaking into the build context
- `docker-compose.yml` boots one `pv-server` service with SQLite persisted in a named `pv_data` volume, `PV_ADDR`/`PV_DB_URL` explicitly mirroring the Dockerfile's own baked-in defaults, and `PV_RP_ID`/`PV_ORIGIN`/`PV_SESSION_TTL_HOURS` interpolated from `.env` with zero-config `localhost` fallbacks
- `.env.example` documents exactly the three operator-overridable env vars, matching `config.rs`'s real `std::env::var("PV_...")` names verbatim — no invented alias
- `docs/SELF-HOSTING.md` (Polish) gives a self-hoster a start-to-finish path: quickstart, env var table, why an incoherent `PV_RP_ID`/`PV_ORIGIN` pair refuses to start (keyed to Plan 07-01's `Config::validate()`), WAL-aware backup/restore, and a troubleshooting table — closes the documentation half of DEPLOY-02; linked from `README.md`

## Task Commits

Each task was committed atomically:

1. **Task 1: Multi-stage `Dockerfile` + `.dockerignore`** - `0e09c80` (feat)
2. **Task 2: `docker-compose.yml` + `.env.example`** - `f52aa3f` (feat)
3. **Task 3: `docs/SELF-HOSTING.md` quickstart + `README.md` link** - `63a0ad9` (docs)

_No TDD RED/GREEN split — these are packaging/config/docs deliverables, not Rust behavior; each task's own commit message documents its deferred Docker-dependent verification commands._

## Files Created/Modified
- `Dockerfile` - 3-stage build; real `pv-core`/`pv-wasm` source, stubbed `pv-server` manifest, `debian:bookworm-slim` runtime with `wget` HEALTHCHECK
- `.dockerignore` - Excludes `target/`, `web/node_modules/`, build artifacts, `.git/`, `.planning/`, `*.md`, and `.env`
- `docker-compose.yml` - Single `pv-server` service, `pv_data` named volume, env interpolation with localhost-safe defaults
- `.env.example` - Documents `PV_RP_ID`/`PV_ORIGIN`/`PV_SESSION_TTL_HOURS` with a comment on why the other three vars are excluded
- `docs/SELF-HOSTING.md` - Polish quickstart, config table, `Config::validate()` explanation, backup/restore, troubleshooting
- `README.md` - New `docs/SELF-HOSTING.md` row in the Struktura table + short Self-hosting section

## Decisions Made
- Stub-manifest treatment scoped exclusively to `crates/pv-server` — `pv-core`/`pv-wasm` get real source up front since `build-wasm.sh` actually compiles and binds them; a stub for either would silently ship an exportless WASM artifact with no build-time error
- `ENV PV_ADDR=0.0.0.0:8620` and `ENV PV_DB_URL=sqlite:///data/pv.db` baked into the runtime stage as the image's own defaults, not left to `docker-compose.yml` alone — a bare `docker run` with no compose file and no extra flags is reachable and persists by default
- `docker-compose.yml`'s `environment:` block re-asserts `PV_ADDR`/`PV_DB_URL` explicitly (belt-and-suspenders documentation of the value, not the only place it's set)
- `.env.example` explicitly excludes `PV_DB_URL`/`PV_ADDR`/`PV_STATIC_DIR` from the overridable list, with an inline comment explaining why overriding them would break the packaged deployment
- `docs/SELF-HOSTING.md` written in Polish, matching `docs/ARCHITECTURE.md`'s existing tone/register

## Deviations from Plan
None - plan executed exactly as written. All Docker-dependent verification steps (`docker build`, `docker run`, `docker compose config/up/down/up`) were deferred per-task, exactly as anticipated and pre-documented in `07-VALIDATION.md`'s Manual-Only Verifications table — this is an environment constraint (no Docker daemon available), not a plan deviation.

## Issues Encountered
Docker is unavailable in this execution environment. Every Docker-dependent `<automated>`/`<verify>` command from the plan (image build, toolchain-leak check, healthz reachability, named-volume persistence, `docker compose config`) is real and scripted but could not be executed here — each task's commit message (`0e09c80`, `f52aa3f`) records the exact deferred commands verbatim so a human on a Docker-capable host can run them. This matches `07-VALIDATION.md`'s pre-declared environment caveat, not an unplanned issue discovered mid-execution.

## User Setup Required
None - no external service configuration required. A self-hoster following `docs/SELF-HOSTING.md` needs only Docker + Docker Compose installed; `.env.example` documents the only operator-facing customization points.

## Next Phase Readiness
- Plan 07-03 (reverse-proxy reference configs + E2E smoke test) can now rely on: a buildable `Dockerfile` producing a running `pv-server` image, and `docker-compose.yml`'s `pv-server` service (name + exposed port 8620) as the base its own `docker-compose.proxy-test.yml` overlay extends.
- No blockers. `docker build .` / `docker compose up`+`down`+`up` persistence remain DEFERRED pending a Docker-capable execution environment, per `07-VALIDATION.md`'s explicit Manual-Only Verifications table — this is the same caveat 07-01's own summary flagged for this plan.

---
*Phase: 07-self-host-packaging-deployment*
*Completed: 2026-07-14*

## Self-Check: PASSED
All 6 declared files found on disk (`Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`, `docs/SELF-HOSTING.md`, `README.md`); all 3 task commit hashes (`0e09c80`, `f52aa3f`, `63a0ad9`) found in git log.
