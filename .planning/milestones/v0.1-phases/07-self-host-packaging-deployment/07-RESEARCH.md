# Phase 7: Self-Host Packaging & Deployment - Research

**Researched:** 2026-07-14
**Domain:** Multi-stage Docker packaging of a Rust axum server + Next.js static export, fail-fast config validation for WebAuthn RP_ID/origin, SQLite WAL tuning, reference reverse-proxy configs (nginx + Caddy) with WebSocket upgrade and access-log token redaction
**Confidence:** HIGH (every codebase claim verified by direct file read; sqlx/tower-http API shapes verified via docs.rs/websearch; nginx/Caddy directive syntax MEDIUM — verify against installed proxy version at implementation time)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1: Base image & multi-stage build strategy**
- Three-stage build: `rust:1-slim`-family builder (matching `rust-toolchain.toml`'s pin) → `node:20-slim`-family builder → `debian:bookworm-slim` runtime. Builder stage compiles `pv-server` release binary **and** the `wasm32-unknown-unknown` build of `pv-core`/`pv-wasm` via the existing `scripts/build-wasm.sh`, since the Node stage's `npm run build` depends on that WASM output already being in place (`predev`/`prebuild` hooks — see Pitfall 1 below, this is the single most important build-ordering fact this phase must get right).
- `COPY` ordering split so editing `pv-server`'s route handlers doesn't invalidate the WASM-build Docker layer cache: copy `crates/pv-core` + `crates/pv-wasm` + `scripts/build-wasm.sh` first, build WASM, *then* copy `crates/pv-server` and build the binary.
- Single root-level `Dockerfile`, no per-arch variants, no `docker/` fragment directory. ARM64 build-ability is expected to work "for free" via multi-arch base images but is not tested/published this phase.
- Runtime stage copies only the compiled `pv-server` binary + the static `web/out/` directory — no Rust toolchain, no Node/npm survive into the shipped image.

**Area 2: Static file serving from axum**
- `tower-http`'s `ServeDir` + `ServeFile` SPA fallback serves `web/out/` from the same `Router`/port as the API — `tower-http`'s `fs` feature added to the existing dependency (currently `["trace", "cors"]`).
- Router nests `/api/*` + `/healthz` first, fallback service second: `ServeDir::new(static_dir).not_found_service(ServeFile::new(static_dir.join("index.html")))`.
- Static dir path configurable via `PV_STATIC_DIR`, default `/app/static` (matches the Dockerfile's `COPY --from=web-builder` target). If the configured directory doesn't exist, log a warning and serve API-only (don't panic) — required so integration tests that build `AppState`/`router()` directly (no real `web/out` build) keep passing.
- No SSR, no Node runtime ships — already locked by `next.config.ts`'s `output: "export"` (Phase 1), only consumed here.

**Area 3: Config validation — fail-fast RP_ID/origin rules**
- `Config` gains a `validate(&self) -> anyhow::Result<()>` method, called from `main.rs` immediately after `Config::from_env()?` and before `build_pool`/`build_webauthn` — earliest possible failure point, `anyhow::Context`-chained error style matching existing convention.
- **Localhost exception, precisely scoped**: skip validation entirely when `rp_id == "localhost"` **or** `rp_origin`'s host is `localhost`/`127.0.0.1`/`::1` — the zero-config defaults must keep working with zero env vars set. The moment either var is explicitly set to something else, full validation engages:
  1. `rp_origin` must parse as an absolute URL with scheme + host (bare `example.com` gets a specific, named error, not a generic parse failure).
  2. `rp_origin`'s scheme must be `https` unless localhost (spec-level WebAuthn requirement — every real browser rejects non-localhost `http://` origins at ceremony time; catch it at startup, not mid-registration).
  3. `rp_id` must equal `rp_origin`'s host or be a registrable parent domain of it — mismatch error names both configured values and the exact relationship required.
  4. `rp_id` must not be an IP address — **Claude's discretion**: duplicate this check, or trust `build_webauthn`'s existing `WebauthnBuilder` `?` propagation and just improve the error text surfaced from that call. Concrete call deferred to plan time (see Pattern 3 below for the recommendation this research arrived at).
- No `PV_PUBLIC_URL` alias — `PV_ORIGIN` remains the sole canonical name.

**Area 4: Migration-on-boot**
- No new mechanism — `build_pool()` already runs `sqlx::migrate!("./migrations").run(&db).await` unconditionally on every startup; migrations are embedded into the binary at compile time (no `COPY` of `migrations/` into the runtime image needed).
- Add WAL journal mode + `busy_timeout` to `build_pool`'s `SqliteConnectOptions` — currently unset.
- Migration failure at boot stays fatal (existing `.context("migrations")?` already propagates via `main`'s `?`).

**Area 5: Volume & DB path**
- Single mounted volume at `/data`; `docker-compose.yml`'s `PV_DB_URL` explicitly set to `sqlite:///data/pv.db` (image-specific default — `config.rs`'s own bare fallback of `sqlite://data/pv.db` stays relative/dev-friendly, unchanged).
- One named volume (`pv_data:/data`). Backup = copy `pv.db` + `-wal`/`-shm` siblings once WAL is on — documented explicitly (a WAL-mode backup that skips `-wal` loses recent writes).
- No volume for static web assets — baked into the image at build time.

**Area 6: Reverse-proxy reference configs — both nginx AND Caddy**
- Both `deploy/nginx.conf.example` and `deploy/Caddyfile.example`, each commented for every non-obvious directive.
- WebSocket upgrade headers are the load-bearing detail: nginx needs the explicit `Upgrade`/`Connection: upgrade` header pair + `proxy_http_version 1.1`; Caddy's `reverse_proxy` handles WS automatically (comment this explicitly so a self-hoster diffing the two configs doesn't wonder why nginx has extra lines Caddy doesn't).
- **Access-log token stripping for `/api/sync/ws?token=...` is a required deliverable** (closes Phase 5's WR-02 gap, named explicitly in `main.rs`'s `make_span` doc comment) — both configs must ship a working, not just described, mechanism.
- Both configs assume TLS termination is the reverse proxy's job — pv-server never gets a cert/key config surface.

**Area 7: Healthcheck**
- Reuse existing `GET /healthz` as-is for Docker `HEALTHCHECK` + compose `healthcheck:` — liveness-only (no DB ping), explicitly deferred to upgrade later.
- `HEALTHCHECK` instruction uses a minimal dependency-free check appropriate to whatever's actually present in the chosen base image — exact tool left to plan/implementation time (see Pitfall 5 below: `debian:bookworm-slim` ships **neither** `curl` nor `wget` by default).

**Area 8: Image publishing scope**
- Self-build only for v0.1: `Dockerfile` + `docker-compose.yml` + `.env.example`, no registry push, no CI release pipeline, no multi-arch manifests — deferred, not required by any DEPLOY-01/02 wording.

### Claude's Discretion
- Whether `Config::validate()` re-implements the IP-address `rp_id` check or trusts `webauthn-rs`'s own internal enforcement and only improves the surfaced error text.
- Exact URL-parsing approach for Area 3 (hand-rolled scheme/host split vs. reusing `url` — already transitively available via `webauthn-rs`).
- Exact wiring shape for `PV_STATIC_DIR`: new `router()` parameter vs. new `Config`/`AppState` field.
- Exact Docker `HEALTHCHECK` tool choice, given `debian:bookworm-slim`'s minimal contents.

### Deferred Ideas (OUT OF SCOPE)
- Auto-TLS inside the container (embedding Caddy-as-library / ACME client in `pv-server`) — TLS is always the reverse proxy's job.
- ARM64/multi-arch published images — Dockerfile should build fine on ARM hosts, but untested/unpublished this phase.
- PostgreSQL as an alternative backend — SQLite-on-volume is the only shipped path for v0.1.
- Backup/restore tooling (`pv-server backup` subcommand, cron snapshot, S3 upload) — manual "copy `/data/pv.db*`" is the documented v0.1 procedure.
- Registry publishing / CI release pipeline (GHCR/Docker Hub push, semver tags, GitHub Actions release workflow).
- `/healthz` upgraded to a DB-touching readiness check.
- A `PV_PUBLIC_URL` env var alias.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEPLOY-01 | Jeden kontener Docker serwuje API + WebSocket + statyczny Next.js export na jednym porcie, migracje automatycznie, SQLite na wolumenie | Architecture Patterns (3-stage Dockerfile diagram), Pattern 1 (WASM-before-Next.js build ordering), Pattern 2 (SPA-fallback router composition), Pitfall 1 (build-order dependency), Pitfall 4 (SIGTERM graceful shutdown gap — found in codebase, not in CONTEXT.md), Code Examples (`docker-compose.yml`, WAL pragmas) |
| DEPLOY-02 | Serwer odmawia startu z konkretnym błędem gdy RP_ID/PUBLIC_URL są źle skonfigurowane dla non-localhost | Pattern 3 (`Config::validate()` decision table + recommended implementation), Common Pitfalls (Pitfall 2: `webauthn-rs`'s own error text is not actionable enough to ship as-is), Security Domain (WebAuthn origin/RP ID threat model), Code Examples (`validate()` skeleton) |
| DEPLOY-01 / DEPLOY-02 (proxy criterion, ROADMAP success criterion #3) | Passkey ceremonies + sync WebSocket work end-to-end behind a documented nginx/Caddy reverse proxy, including WS upgrade headers and access-log token stripping | Architecture Patterns (reverse-proxy diagram), Pattern 4 (nginx WS + log-redaction blocks), Pattern 5 (Caddy WS + `query` log filter), Pitfall 3 (nginx has no per-param log redaction primitive — must use a scoped `log_format`), Sources (Caddy `query` filter docs, verified 2026) |

## Project Constraints (from CLAUDE.md)

- **Deployment:** single Docker container, SQLite on a volume, no required external services — this phase *is* that constraint made concrete; no k8s, no Redis, no S3.
- **Tech stack:** Rust (axum + SQLx) server; `pv-core` shared via WASM; Next.js 15+/Tailwind v4/DaisyUI 5 frontend with `output: "export"` — this phase adds zero new Rust crate dependencies to the workspace's `[workspace.dependencies]` (Area 3's URL parsing is transitively available; `tower-http`'s `fs` feature is additive to an existing dependency).
- **Krypto/zero-knowledge:** unaffected — this phase touches no crypto path; `pv-core`/`pv-wasm` are consumed as opaque build artifacts.
- **Design:** unaffected — no UI surface in this phase beyond static-file serving of the already-built `web/out/`.
- **Solo-indie pragmatism:** self-build-only Docker artifacts, both proxies documented (not either/or, per ROADMAP's explicit "nginx/Caddy" wording), no enterprise CI/registry scope.
- **`anyhow::Context`-chained errors, small focused functions, `#[cfg(test)] mod tests` convention** — `Config::validate()` must follow the exact idiom already established in `build_pool`/`build_webauthn` (`.context("...")?`), not introduce a new error style.
- **Doc comments forward/back-reference phases by name** — this project's established convention (`config.rs`'s `rp_id` comment already says "groundwork for Phase 7's DEPLOY-02"; `main.rs`'s WR-02 comment already names this phase's proxy-doc obligation) — new code in this phase should close those loops explicitly in comments, not silently.

## Summary

Phase 7 is exclusively build/ops/config-validation work — no new business logic, no new crypto path, no new npm/crate dependency beyond one additive `tower-http` feature flag. Three genuinely load-bearing technical facts were confirmed this session, none of which were fully spelled out in `07-CONTEXT.md`:

1. **The web build's dependency on a pre-built WASM artifact is a real Docker-ordering hazard, not just a caching nicety.** `web/package.json`'s `prebuild`/`predev` hooks run `scripts/build-wasm.sh` (verified in this session's file read), which itself needs Rust + the `wasm32-unknown-unknown` target + a version-pinned `wasm-bindgen-cli` install (`cargo install wasm-bindgen-cli --version <pinned>`) and moves its output into `web/public/wasm/pv_wasm_bg.wasm` + `web/src/lib/crypto/wasm/pv_wasm.js` *before* `next build` can succeed. The Rust builder stage must therefore run `scripts/build-wasm.sh` and hand its output to the Node stage's checkout — either by running the script from within the Node stage too (duplicating the Rust toolchain there, wasteful) or, better, by running `build-wasm.sh`'s output-producing steps in the Rust builder stage and `COPY --from=rust-builder` those two generated paths into the Node builder stage's `web/` tree before `npm run build`. This is the single detail most likely to produce a broken image if skipped.
2. **`docker stop` sends SIGTERM, and `main.rs`'s current `shutdown_signal()` only listens for `tokio::signal::ctrl_c()` (SIGINT).** Verified by direct read of `crates/pv-server/src/main.rs`. Inside a container, `docker stop`'s default signal is SIGTERM; a process that doesn't trap it never gets `axum::serve`'s `with_graceful_shutdown` future to resolve, so Docker's 10-second default grace period always elapses and every container stop becomes a hard SIGKILL — connections mid-flight (including open sync WebSockets) are dropped ungracefully rather than closed. This is a genuine, concrete gap this phase should close (not previously flagged in CONTEXT.md, which only discusses SIGTERM in passing under "graceful shutdown" without naming the SIGINT/SIGTERM mismatch).
3. **`debian:bookworm-slim` ships neither `curl` nor `wget`.** CONTEXT.md deferred the exact `HEALTHCHECK` tool choice to implementation time "based on what's already in the base image" — verified this session that *nothing* HTTP-capable is preinstalled on that base, so the Dockerfile must explicitly `apt-get install --no-install-recommends wget` (smallest of the two, ~1-2MB) in the runtime stage, or accept a `curl` install of similar size. There is no zero-install option compatible with a `GET /healthz` HTTP check on this base image.

Everything else in this phase is corroborating existing locked decisions against the real API surfaces: `sqlx` 0.8's `SqliteConnectOptions::journal_mode(SqliteJournalMode::Wal)` + `.busy_timeout(Duration)` are confirmed real, chainable options (`docs.rs`, verified); `tower-http`'s `ServeDir::not_found_service(ServeFile::new(...))` is the confirmed idiomatic SPA-fallback pattern; Caddy 2.5+'s `log { format filter { fields { uri query { delete token } } } }` is the confirmed, version-real mechanism for query-param log redaction (this is the concrete answer to Phase 5's WR-02 follow-up for the Caddy side — nginx has no equivalent per-param primitive and must instead scope a custom `log_format` that logs `$uri` instead of `$request`/`$request_uri` for the one location block).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Static Next.js export serving | pv-server (axum + tower-http `ServeDir`) | — | One port, one process — DEPLOY-01's literal wording; no nginx-in-container |
| API + WebSocket routing | pv-server (axum `Router`) | — | Unchanged from Phases 1-6; this phase adds a fallback service, not new routes |
| Config fail-fast validation | pv-server (`Config::validate()`) | — | DEPLOY-02; must run before any I/O (DB connect, webauthn build, socket bind) |
| Migration-on-boot | pv-server (`build_pool`, existing) | SQLite / Database | Already correct; this phase only adds WAL/busy_timeout pragmas alongside it |
| SQLite persistence | Docker named volume (`/data`) | — | DEPLOY-01's "SQLite na wolumenie"; survives container recreation |
| TLS termination | Reverse proxy (nginx/Caddy, operator-provided) | — | Never pv-server's concern; no cert/key config surface added |
| Reverse-proxy WS upgrade + access-log redaction | `deploy/nginx.conf.example` / `deploy/Caddyfile.example` | — | Closes Phase 5 WR-02; proxy access logs are outside pv-server's own log-redaction reach |
| Container lifecycle (build, healthcheck, graceful stop) | `Dockerfile` + `docker-compose.yml` | pv-server (`shutdown_signal`) | SIGTERM handling must be fixed in `main.rs`, not just documented in Docker config |

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|---|---|---|---|
| `tower-http` (feature: `fs`) | 0.6 (already pinned) `[VERIFIED: crates.io + docs.rs]` | `ServeDir`/`ServeFile` static file serving with SPA fallback | Already the project's dependency; `fs` is an additive feature flag, not a new crate |
| `debian:bookworm-slim` | current tag | Final runtime image base | Ships a shell (needed for the config-validation error path and entrypoint scripting) unlike distroless; smaller attack surface than a full `debian:bookworm` |
| `rust:1-slim` (pinned to `rust-toolchain.toml`'s channel) | matches `stable` + `wasm32-unknown-unknown` target | Builder stage 1 (Rust + WASM compile) | Must match the repo's own toolchain file exactly to avoid a build reproducing a different compiler than local dev |
| `node:20-slim` (or current LTS matching `web/package.json`'s engines, none pinned currently) | 20 LTS | Builder stage 2 (`npm ci && npm run build`) | Next.js 16.2.10 (per `web/package.json`) requires a current Node LTS; 20 is the safe minimum |

### Supporting

| Tool | Version | Purpose | When to Use |
|---|---|---|---|
| `wget` (or `curl`) | Debian bookworm's packaged version | `HEALTHCHECK` HTTP probe against `/healthz` | Neither is present on `debian:bookworm-slim` by default — must be explicitly `apt-get install`ed in the runtime stage; `wget --spider` is the marginally smaller/more common choice for this exact use case |
| `wasm-bindgen-cli` | exact version parsed from `crates/pv-wasm/Cargo.toml` (existing pin, unchanged) | Generates JS/TS glue for `pv-wasm` inside the builder stage | Already version-locked by `scripts/build-wasm.sh`'s existing logic — Dockerfile's builder stage runs the same script, no new pin decision |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| `debian:bookworm-slim` runtime | `gcr.io/distroless/cc-debian12` | Smaller, no shell — but the config-validation fail-fast error path (Area 3) benefits from an image that can still run trivial shell-based entrypoint/debugging steps if a self-hoster needs to exec in; CONTEXT.md already locked `bookworm-slim` for this reason, not revisited here |
| Explicit `wget`/`curl` HEALTHCHECK | A tiny compiled Rust healthcheck binary invoked as `pv-server --healthcheck` (self-contained TCP/HTTP probe, no extra apt package) | Genuinely smaller image (no extra package) and avoids the "nothing preinstalled" problem entirely — **worth flagging to the planner as a superior alternative** to installing `wget`, since the binary is already present and a `--healthcheck` CLI flag is a small, idiomatic addition; CONTEXT.md left the exact tool choice open, and this option wasn't in its list |
| Custom nginx per-param log redaction | A `map` variable computing a stripped URI, used in a location-scoped `log_format` | nginx has no built-in per-query-param delete primitive (unlike Caddy's `query { delete ... }` filter) — the only real options are (a) log `$uri` (no query string at all) for that one location, discarding the whole query string, or (b) a Lua-based `access_by_lua`/`njs` rewrite (extra module dependency, disproportionate for a self-host reference config) — (a) is simplest and sufficient since `/api/sync/ws` has no other query params worth keeping in logs |

**Installation:** No new install commands — this phase's only dependency change is `tower-http`'s existing `Cargo.toml` line gaining `"fs"` in its feature list:
```toml
tower-http = { version = "0.6", features = ["trace", "cors", "fs"] }
```

**Version verification:** `tower-http` 0.6 already resolved in `Cargo.lock` (existing workspace dependency); `fs` feature confirmed to exist on `tower-http` 0.6's docs.rs feature list (contains `ServeDir`/`ServeFile` gated behind it). `debian:bookworm-slim`'s lack of `curl`/`wget` confirmed via websearch cross-referencing multiple minimal-base-image healthcheck guides (no direct docs.rs/registry check applicable to a Docker base image — MEDIUM confidence, standard knowledge, verify with a throwaway `docker run debian:bookworm-slim which wget curl` at implementation time).

## Package Legitimacy Audit

No new npm/crate packages this phase — `tower-http`'s `fs` feature is additive to an already-audited dependency (Phase 1-era); `debian:bookworm-slim`/`node:20-slim`/`rust:1-slim` are official Docker Hub/OCI base images, not subject to the package-legitimacy protocol (base images, not application dependencies).

**Packages removed due to `[SLOP]` verdict:** none — no new packages introduced.

## Architecture Patterns

### System Architecture Diagram

```text
DOCKER BUILD (3 stages)
────────────────────────────────────────────────────────────────
Stage 1: rust-builder (rust:1-slim, wasm32-unknown-unknown target)
  COPY Cargo.toml Cargo.lock rust-toolchain.toml .
  COPY crates/pv-core crates/pv-wasm scripts/build-wasm.sh .
  RUN scripts/build-wasm.sh
    → produces: web/src/lib/crypto/wasm/pv_wasm.js
                web/public/wasm/pv_wasm_bg.wasm
  COPY crates/pv-server .
  RUN cargo build -p pv-server --release
    → produces: target/release/pv-server

Stage 2: web-builder (node:20-slim)
  COPY web/package.json web/package-lock.json .
  RUN npm ci
  COPY web/ .
  COPY --from=rust-builder /app/web/src/lib/crypto/wasm ./src/lib/crypto/wasm
  COPY --from=rust-builder /app/web/public/wasm ./public/wasm
  RUN npm run build   # `next build`, output: "export" → web/out/
    (predev/prebuild's own build-wasm.sh invocation must be skipped/no-op
     here since the WASM artifacts are already staged — see Pitfall 1)

Stage 3: runtime (debian:bookworm-slim)
  RUN apt-get update && apt-get install -y --no-install-recommends wget \
      && rm -rf /var/lib/apt/lists/*
  COPY --from=rust-builder /app/target/release/pv-server /app/pv-server
  COPY --from=web-builder /app/web/out /app/static
  ENV PV_STATIC_DIR=/app/static
  HEALTHCHECK CMD wget --spider -q http://127.0.0.1:8620/healthz || exit 1
  ENTRYPOINT ["/app/pv-server"]


RUNTIME REQUEST ROUTING (single port, single process)
────────────────────────────────────────────────────────────────
  Client request
        │
        ▼
  axum Router
        ├── /healthz              → healthz()
        ├── /api/*                → existing route modules (auth/vault/folders/sync/passkeys/sessions)
        └── fallback               → ServeDir(/app/static)
                                       .not_found_service(ServeFile(/app/static/index.html))
                                     (SPA fallback: any unmatched path still resolves
                                      to index.html for Next.js's client router)


REVERSE PROXY TOPOLOGY (documented, tested reference)
────────────────────────────────────────────────────────────────
  Browser ── HTTPS ──▶ [nginx | Caddy]
                          │  proxy_pass / reverse_proxy → http://pv-server:8620
                          │  Upgrade/Connection headers forwarded (WS)
                          │  Host header forwarded unchanged (must match PV_ORIGIN's host)
                          │  access log: /api/sync/ws logged WITHOUT ?token=... query string
                          ▼
                     pv-server:8620 (container, PV_ORIGIN=https://vault.example.com,
                                      PV_RP_ID=vault.example.com)


GRACEFUL SHUTDOWN (gap found this session — must be fixed, not just documented)
────────────────────────────────────────────────────────────────
  docker stop  ──SIGTERM──▶  PID 1 (pv-server)
                                  │
                                  ▼ (CURRENT: only tokio::signal::ctrl_c() = SIGINT is awaited —
                                  │  SIGTERM is NOT trapped, so nothing happens here today)
                                  ▼ (REQUIRED FIX: also await
                                  │  tokio::signal::unix::signal(SignalKind::terminate()))
                          axum's with_graceful_shutdown resolves
                                  │
                                  ▼
                          in-flight requests/WS connections drain,
                          then process exits 0 within Docker's stop-timeout
```

### Recommended Project Structure
```
Dockerfile                          # NEW: 3-stage build (repo root)
docker-compose.yml                  # NEW: pv-server + named volume (repo root)
.env.example                        # NEW: PV_RP_ID/PV_ORIGIN/PV_DB_URL/PV_SESSION_TTL_HOURS/PV_ADDR/PV_STATIC_DIR (repo root)
.dockerignore                       # NEW: exclude target/, node_modules/, web/out/, .git/ from build context
deploy/
├── nginx.conf.example              # NEW: HTTP + WS upgrade + log-redaction for /api/sync/ws
└── Caddyfile.example                # NEW: auto-HTTPS + WS (automatic) + query{} log filter
docs/SELF-HOSTING.md                 # NEW (or README.md section): end-to-end docker run/compose + proxy walkthrough

crates/pv-server/src/
├── config.rs                        # + Config::validate(&self) -> anyhow::Result<()>
│                                      + PV_STATIC_DIR field (or threaded separately, see Pattern 2)
├── lib.rs                           # build_pool() + WAL/busy_timeout pragmas
├── main.rs                          # + cfg.validate()? call; + SIGTERM handling in shutdown_signal()
└── routes/mod.rs                    # router() + static_dir param + ServeDir/ServeFile fallback nest

crates/pv-server/tests/
└── config_validate.rs               # NEW: decision-table integration tests for Config::validate()
```

### Pattern 1: WASM-artifact staging across Docker build stages (the load-bearing ordering fix)
**What:** `scripts/build-wasm.sh` is designed to be run from the repo root by `npm`'s `prebuild`/`predev` lifecycle hooks (verified: `web/package.json`'s `"prebuild": "bash ../scripts/build-wasm.sh"`), and it writes its two output artifacts directly into `web/public/wasm/` and `web/src/lib/crypto/wasm/` — i.e., it expects to run in a checkout where `web/` already exists as a sibling of `crates/`. In a multi-stage Docker build, stage 1 (Rust) and stage 2 (Node) are **separate filesystems** — the Node stage cannot invoke `scripts/build-wasm.sh` itself without also installing the entire Rust+wasm32 toolchain into what should be a Node-only stage (defeating the purpose of separate stages).
**When to use:** Any Dockerfile stage boundary where a later stage's `npm run build` step depends on the earlier stage's compiled artifact.
**Example:**
```dockerfile
# Stage 1 already ran scripts/build-wasm.sh, producing:
#   /app/web/public/wasm/pv_wasm_bg.wasm
#   /app/web/src/lib/crypto/wasm/pv_wasm.js  (+ .d.ts, etc.)
# Stage 2 copies those two directories in BEFORE `npm run build`, and the
# build script itself must become a no-op / be skipped in this stage (e.g.
# a `PV_SKIP_WASM_BUILD=1` env check inside build-wasm.sh, or simply not
# invoking `npm run build` in a way that triggers prebuild — `next build`
# directly, bypassing the npm script's prebuild hook, is the simplest fix
# since the artifacts are already staged and re-running the script would
# require the Rust toolchain in this stage anyway).
FROM node:20-slim AS web-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts   # <-- --ignore-scripts skips prebuild/predev
COPY web/ .
COPY --from=rust-builder /app/web/public/wasm ./public/wasm
COPY --from=rust-builder /app/web/src/lib/crypto/wasm ./src/lib/crypto/wasm
RUN npx next build
```
**Source:** verified by direct read of `web/package.json` (prebuild/predev hooks) and `scripts/build-wasm.sh` (exact output paths, lines 5/7 confirmed: `mkdir -p web/src/lib/crypto/wasm web/public/wasm`, later `mv web/src/lib/crypto/wasm/pv_wasm_bg.wasm web/public/wasm/pv_wasm_bg.wasm`).

### Pattern 2: SPA-fallback router composition without breaking the test harness
**What:** `router(state: AppState) -> Router` currently takes only `AppState`. Adding a static-serving fallback needs a directory path that does not exist in the integration-test harness (`crates/pv-server/tests/` builds `AppState`/`router()` directly, never runs a real `web/out` build). CONTEXT.md flags the wiring shape as a plan-time call; this research recommends threading it as a plain `Option<PathBuf>` parameter to `router()` rather than a new `AppState` field, since `AppState` is `Clone` and cheaply shared per-request (a static dir path threaded once at router-construction time has no need to be re-read per request the way `AppState`'s fields are).
**When to use:** `crates/pv-server/src/routes/mod.rs`'s `router()` signature change; `main.rs`'s call site.
**Example:**
```rust
// routes/mod.rs
pub fn router(state: AppState, static_dir: Option<PathBuf>) -> Router {
    let api = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/auth/prelogin", post(auth::prelogin))
        // ...unchanged existing routes...
        .with_state(state)
        .layer(cors_layer());

    match static_dir.filter(|d| d.is_dir()) {
        Some(dir) => {
            let serve = ServeDir::new(&dir)
                .not_found_service(ServeFile::new(dir.join("index.html")));
            api.fallback_service(serve)
        }
        None => {
            tracing::warn!("PV_STATIC_DIR not set or not a directory — serving API only");
            api
        }
    }
}
```
```rust
// main.rs
let static_dir = std::env::var("PV_STATIC_DIR").ok().map(PathBuf::from);
let app = routes::router(state, static_dir)
    .layer(TraceLayer::new_for_http().make_span_with(make_span));
```
Existing test call sites (`crates/pv-server/tests/*.rs`) pass `None` and are unaffected.
**Source:** `docs.rs/tower-http/latest/tower_http/services/struct.ServeDir.html` (`not_found_service` method, verified via websearch); direct read of `crates/pv-server/src/routes/mod.rs`'s current signature.

### Pattern 3: `Config::validate()` decision table implementation
**What:** A pure, testable method separate from `from_env()`, matching the codebase's "validate, then use" convention (`kdf.rs` precedent per `06-CONTEXT.md`/prior phases). Recommendation on the one open discretion point (IP-address `rp_id` check): **do not duplicate it** — `webauthn_rs::prelude::WebauthnBuilder::new(rp_id, &origin_url)` already rejects an IP-address `rp_id` internally (confirmed by this project's own existing test `build_webauthn_rejects_mismatched_rp_id_origin`, which exercises the builder's own validation path), so `Config::validate()` should focus purely on the checks that `build_webauthn` does **not** already make actionable: the "did you forget `https://`" and "these two configured values disagree" cases, which today surface only as an opaque `WebauthnBuilder`/`Url::parse` error deep inside `build_pool`/`build_webauthn`'s call chain, discovered after a DB connection is already open.
**When to use:** `crates/pv-server/src/config.rs`, called from `main.rs` before `build_pool`.
**Example:**
```rust
impl Config {
    pub fn validate(&self) -> anyhow::Result<()> {
        if self.is_localhost_deployment() {
            return Ok(());
        }

        let origin = url::Url::parse(&self.rp_origin).with_context(|| {
            format!(
                "PV_ORIGIN={:?} is not a valid absolute URL — expected e.g. https://vault.example.com",
                self.rp_origin
            )
        })?;

        let host = origin.host_str().with_context(|| {
            format!("PV_ORIGIN={:?} has no host component", self.rp_origin)
        })?;

        if origin.scheme() != "https" {
            anyhow::bail!(
                "PV_ORIGIN={:?} must use https:// for a non-localhost deployment \
                 (WebAuthn refuses http:// origins outside localhost in every real browser)",
                self.rp_origin
            );
        }

        if !(host == self.rp_id || host.ends_with(&format!(".{}", self.rp_id))) {
            anyhow::bail!(
                "PV_RP_ID={:?} must equal PV_ORIGIN's host ({:?}) or be its registrable \
                 parent domain — e.g. PV_RP_ID=example.com with PV_ORIGIN=https://vault.example.com",
                self.rp_id, host
            );
        }

        Ok(())
    }

    fn is_localhost_deployment(&self) -> bool {
        if self.rp_id == "localhost" {
            return true;
        }
        url::Url::parse(&self.rp_origin)
            .ok()
            .and_then(|u| u.host_str().map(|h| matches!(h, "localhost" | "127.0.0.1" | "::1")))
            .unwrap_or(false)
    }
}
```
```rust
// main.rs, immediately after Config::from_env()?
let cfg = Config::from_env()?;
cfg.validate()?;   // fails loudly here, before any DB connect or Webauthn build
```
**Source:** `crates/pv-server/src/config.rs`/`lib.rs` direct reads (existing `rp_id`/`rp_origin` fields, existing `build_webauthn` error-context style); `url` crate confirmed transitively available (already a dependency of `webauthn-rs` per its own `Cargo.toml` dependency tree — no new direct dependency line needed, though adding an explicit `url = "2"` direct dependency for clarity is a reasonable, low-risk plan-time call given `[workspace.dependencies]`'s existing pattern of naming shared deps explicitly).

### Pattern 4: nginx reference config — WS upgrade + scoped access-log redaction
**What:** Classic `map`-based upgrade-connection idiom plus a location-scoped `log_format` that logs `$uri` (path only) instead of `$request`/`$request_uri` for exactly the sync WS route, closing WR-02 on the nginx side.
**When to use:** `deploy/nginx.conf.example`.
**Example:**
```nginx
# deploy/nginx.conf.example
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# Logs the WS endpoint's path only — never the query string, which carries
# the live session bearer token (?token=...). See crates/pv-server/src/
# main.rs's make_span doc comment (WR-02) for the server-side half of this
# same redaction; this closes the reverse-proxy-side gap that comment names.
log_format sync_ws_redacted '$remote_addr - [$time_local] "$request_method $uri" $status';

server {
    listen 443 ssl;
    server_name vault.example.com;

    # ssl_certificate / ssl_certificate_key: provisioned separately
    # (certbot/Let's Encrypt or your own CA) — out of scope here.

    location /api/sync/ws {
        access_log /var/log/nginx/access.log sync_ws_redacted;
        proxy_pass http://127.0.0.1:8620;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://127.0.0.1:8620;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
**Source:** nginx upgrade-map idiom is the standard documented pattern (websearch cross-referenced against multiple nginx WS proxying guides); `$uri`-vs-`$request` log-format distinction confirmed via websearch (`$request_uri`/`$uri` variable reference).

### Pattern 5: Caddy reference config — automatic WS + `query { delete }` log filter
**What:** Caddy 2.5+'s `log` directive supports a `filter` format with a `query` sub-filter that can `delete`/`replace`/`hash` individual query-string keys on the logged `request>uri` field — this is a real, version-verified mechanism (not a workaround), directly closing WR-02 on the Caddy side with less config than nginx needs.
**When to use:** `deploy/Caddyfile.example`.
**Example:**
```caddyfile
# deploy/Caddyfile.example
vault.example.com {
    # Caddy auto-provisions TLS for this domain (Let's Encrypt) — no
    # ssl_certificate config needed, unlike the nginx reference.

    # WebSocket upgrade for /api/sync/ws is automatic — reverse_proxy
    # detects the Upgrade header itself, no special directive needed here
    # (unlike nginx's explicit map+headers pair above).
    reverse_proxy 127.0.0.1:8620

    log {
        output file /var/log/caddy/access.log
        format filter {
            wrap console
            fields {
                uri query {
                    # Strips the live session bearer token from
                    # /api/sync/ws?token=... before it ever reaches this
                    # proxy's own access log — mirrors pv-server's own
                    # make_span redaction (WR-02, crates/pv-server/src/main.rs).
                    delete token
                }
            }
        }
    }
}
```
**Source:** Caddy's `logging` module docs + the `#4424` commit adding the query filter (websearch, cross-referenced with a second independent guide describing the same `fields { uri query { delete ... } } }` shape) — **verify the exact Caddyfile nesting against the installed Caddy version's `caddy fmt`/`caddy validate` at implementation time**, since Caddyfile directive nesting syntax has shifted across 2.x minor versions and this is MEDIUM, not HIGH, confidence.

### Anti-Patterns to Avoid
- **Running `scripts/build-wasm.sh` (or reinstalling the Rust toolchain) inside the Node builder stage** — defeats the entire purpose of a 3-stage build; stage 2 should only ever consume stage 1's already-built WASM artifacts via `COPY --from=rust-builder`.
- **Using `npm run build` (which triggers the `prebuild` npm lifecycle hook) unmodified inside the Node stage** — it will try to re-run `bash ../scripts/build-wasm.sh`, which either fails outright (no `cargo`/Rust toolchain in the Node-only stage) or silently no-ops in a way that's hard to distinguish from success; use `npm ci --ignore-scripts` + `npx next build` directly, or make `build-wasm.sh` idempotent-skip when its outputs already exist and are newer than their sources.
- **Trusting `tokio::signal::ctrl_c()` alone for "graceful shutdown" in a containerized deployment** — this only traps SIGINT; `docker stop`'s default signal is SIGTERM. Confirmed gap in this codebase's current `main.rs`; must add `tokio::signal::unix::signal(SignalKind::terminate())` alongside the existing `ctrl_c()` future (`tokio::select!` between the two) for `docker stop` to actually trigger graceful shutdown rather than always hitting the SIGKILL timeout.
- **Assuming `debian:bookworm-slim` has `curl`/`wget` preinstalled** — it does not; either install one explicitly or (better) add a `--healthcheck` mode to the `pv-server` binary itself and avoid the extra apt package entirely.
- **Duplicating `webauthn-rs`'s own IP-address/RP-ID validation logic inside `Config::validate()`** — creates two copies of the same rule that can silently drift; let `build_webauthn`'s existing `?`-propagated error handle that one case, and have `Config::validate()` cover only the gaps (missing scheme, http-not-https, mismatched host/parent-domain) that produce genuinely unhelpful error text today.
- **Skipping the `PV_STATIC_DIR`-not-found guard and unconditionally mounting `ServeDir`** — would panic or 500 every integration test that builds `router()` without a real `web/out/` directory present (the entire `crates/pv-server/tests/` suite does this today).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| SPA fallback (unmatched routes → `index.html`) | A custom axum handler that reads `index.html` off disk on every miss | `tower-http`'s `ServeDir::not_found_service(ServeFile::new(...))` | Already handles caching headers (`ETag`/`Last-Modified`), range requests, and correct MIME types for the whole static tree — a hand-rolled handler would need to reimplement all of that for zero benefit |
| WAL mode / busy-timeout tuning | Manual `PRAGMA journal_mode=WAL;`/`PRAGMA busy_timeout=5000;` issued as raw SQL after connecting | `SqliteConnectOptions::journal_mode(SqliteJournalMode::Wal)` + `.busy_timeout(Duration::from_secs(5))` | These are first-class connect-option builder methods in `sqlx` 0.8 (verified docs.rs) — setting them via raw SQL after the fact risks a race on the very first connection in the pool before the pragma takes effect on every subsequent one |
| Reverse-proxy query-param log redaction (Caddy) | A Lua/njs script or an nginx-only workaround applied uniformly to both proxies | Caddy's native `query { delete <key> }` log filter | Caddy has a real first-class primitive for exactly this; using it is simpler and more maintainable than forcing nginx's workaround pattern onto Caddy too |
| Docker healthcheck HTTP probe | A hand-rolled TCP probe shell one-liner (`/dev/tcp/...` redirection) | `wget --spider` (if installing a package is acceptable) or a `pv-server --healthcheck` CLI flag (if not) | `/dev/tcp` redirection is a bash-ism not guaranteed to work under `debian:bookworm-slim`'s default `/bin/sh` (dash), and doesn't verify an actual HTTP 200 the way a real HTTP client / the app's own logic can |

**Key insight:** This phase's only two "don't hand-roll" additions beyond what's already in the dependency tree are `tower-http`'s `fs` feature (a flag flip, not a new crate) and a `wget`/healthcheck-flag choice for the runtime image — everything else is composing already-present, already-verified APIs (`sqlx`'s connect-options builder, `webauthn-rs`'s own validation, Caddy's native log filter) rather than adding new surface area.

## Common Pitfalls

### Pitfall 1: Docker build breaks if the Node stage re-triggers `scripts/build-wasm.sh`
**What goes wrong:** `npm run build`/`npm install` inside the Node-only stage silently or loudly fails because `prebuild`/`predev` hooks call `bash ../scripts/build-wasm.sh`, which requires `cargo`, the `wasm32-unknown-unknown` target, and `wasm-bindgen-cli` — none of which exist in a `node:20-slim`-based stage.
**Why it happens:** The hook is correct and desirable for local dev (`npm run dev`/`npm run build` "just work" from a full checkout) but assumes a single-filesystem, single-toolchain environment — an assumption multi-stage Docker builds deliberately break.
**How to avoid:** `npm ci --ignore-scripts` in the Node stage, `COPY --from=rust-builder` the two WASM output directories before running `next build` directly (bypassing the npm script wrapper that would re-trigger the hook), per Pattern 1 above.
**Warning signs:** A Docker build log showing `cargo: not found` or `rustup: not found` partway through what should be the Node stage; or a build that "succeeds" but produces a `web/out/` missing WASM-dependent functionality because the hook silently no-op'd.

### Pitfall 2: Shipping `webauthn-rs`'s raw error text as the DEPLOY-02 "actionable error"
**What goes wrong:** `build_webauthn`'s existing `.context("PV_RP_ID must be an effective domain of PV_ORIGIN")` is already reasonably good, but a bare `Url::parse` failure on a bare-domain `PV_ORIGIN` value (e.g. `example.com` with no scheme) surfaces as a generic "invalid PV_ORIGIN" with no hint about the missing `https://` — a self-hoster's first instinct won't necessarily be "I forgot the scheme."
**Why it happens:** `Url::parse("example.com")` doesn't error at all in every case (it can be misparsed as a relative-looking value or a different scheme depending on exact input) — the specific "did you mean to write `https://example.com`?" guidance has to be added deliberately, it doesn't fall out of the underlying library's error type for free.
**How to avoid:** `Config::validate()` (Pattern 3) explicitly names the missing-scheme case in its own error message rather than relying solely on `Url::parse`'s or `WebauthnBuilder`'s generic error text.
**Warning signs:** A startup error message that says only "invalid PV_ORIGIN" or "failed to build Webauthn instance" without naming which of the four DEPLOY-02 rules was violated.

### Pitfall 3: nginx has no per-query-param log redaction primitive — don't try to fake one with `$request_uri` manipulation
**What goes wrong:** Attempting to reconstruct a "query string minus `token`" value in nginx's `map`/`log_format` for just one parameter requires either regex-based `map` rules (fragile if other query params are ever added to the WS URL) or an extra module (`njs`/Lua) disproportionate for a reference config.
**Why it happens:** Unlike Caddy's structured `query { delete <key> }` filter, nginx's logging pipeline works on whole string variables (`$request`, `$request_uri`, `$args`) with no built-in per-key deletion.
**How to avoid:** For the one route that matters (`/api/sync/ws`), just drop the query string from the logged value entirely (`$uri` instead of `$request`/`$request_uri`) — acceptable because there's nothing else worth keeping in that route's query string for operational log purposes; document this scope explicitly in the reference config's comments so a self-hoster who adds a second query param to that route later knows to re-check.
**Warning signs:** A nginx config with a regex `map` block trying to strip `token=[^&]*` from `$request_uri` — fragile, hard to review, and easy to get subtly wrong (e.g. not handling `token` appearing after another `&`-joined param).

### Pitfall 4: `main.rs`'s current graceful-shutdown only traps SIGINT, not SIGTERM (found this session, not in CONTEXT.md)
**What goes wrong:** `docker stop <container>` sends SIGTERM by default; `shutdown_signal()`'s current body (`tokio::signal::ctrl_c().await`) only resolves on SIGINT (`Ctrl+C`/`docker stop --signal SIGINT` explicitly, which is not the default). Every ordinary `docker stop`/`docker compose down`/orchestrator-issued stop therefore never triggers `axum::serve`'s graceful-shutdown path — the process sits until Docker's stop-timeout (10s default) elapses, then gets SIGKILLed, abruptly dropping any open sync WebSocket connections and in-flight requests instead of draining them.
**Why it happens:** `tokio::signal::ctrl_c()` is a cross-platform convenience that intentionally only covers the interactive-terminal-interrupt signal; SIGTERM handling requires the Unix-specific `tokio::signal::unix::signal(SignalKind::terminate())`, which is a deliberate additional call, not something `ctrl_c()` covers implicitly.
**How to avoid:** Update `shutdown_signal()` to `tokio::select!` between `ctrl_c()` and a `SignalKind::terminate()` stream, resolving on whichever fires first — a small, targeted fix directly serving DEPLOY-01's "graceful shutdown" expectation for a containerized deployment.
**Warning signs:** `docker stop` on a running container always taking the full timeout before exiting (visible via `time docker stop <container>` consistently reporting ~10s regardless of load); sync WebSocket clients observing an abrupt connection reset rather than a clean close frame during a deploy/restart.

### Pitfall 5: `debian:bookworm-slim` has no HTTP client preinstalled for `HEALTHCHECK`
**What goes wrong:** A `HEALTHCHECK CMD curl -f http://localhost:8620/healthz || exit 1` (or the `wget` equivalent) fails immediately with "command not found" if the Dockerfile doesn't explicitly install one — Docker reports the container as permanently `unhealthy` from the first check onward, even though the server itself is running fine.
**Why it happens:** `-slim` Debian variants deliberately exclude both HTTP clients to minimize image size/attack surface; this is by design, not an oversight in the base image.
**How to avoid:** Either `apt-get install --no-install-recommends wget` (small, ~1-2MB size cost, simplest) in the runtime stage, or add a `pv-server --healthcheck` CLI mode that makes a loopback HTTP request using the already-compiled binary's own HTTP client stack (no new apt package at all) — the second option is strictly smaller and avoids depending on apt package availability/naming drift across future Debian releases, and is worth recommending to the planner as the preferred choice over CONTEXT.md's more generic "whichever tool is already present" framing (since research this session found neither tool is present).
**Warning signs:** `docker ps` showing the container's status as `(unhealthy)` immediately after a fresh build, with `docker inspect --format='{{json .State.Health}}'` showing an `"exec: \"wget\": executable file not found in $PATH"`-shaped error.

## Code Examples

### `docker-compose.yml` reference shape
```yaml
# Source: standard compose shape for a single-service self-hosted app with
# a named volume; PV_DB_URL's absolute /data path pairs with the volume
# mount per Area 5's locked decision.
services:
  pv-server:
    build: .
    ports:
      - "8620:8620"
    environment:
      PV_DB_URL: sqlite:///data/pv.db
      PV_RP_ID: ${PV_RP_ID:-localhost}
      PV_ORIGIN: ${PV_ORIGIN:-http://localhost:8620}
      PV_ADDR: 0.0.0.0:8620
    volumes:
      - pv_data:/data
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://127.0.0.1:8620/healthz"]
      interval: 30s
      timeout: 3s
      retries: 3
    restart: unless-stopped

volumes:
  pv_data:
```
Note: `PV_ADDR` must bind `0.0.0.0`, not the code's own default `127.0.0.1:8620` — the default is correct for bare-metal `cargo run` but would make the server unreachable from outside its own container network namespace if left unset in the compose file. This is a real, easy-to-miss self-host gotcha worth calling out explicitly in `.env.example`'s comments.

### SQLite WAL + busy_timeout addition to `build_pool`
```rust
// Source: docs.rs/sqlx SqliteConnectOptions (verified via websearch,
// method names/chaining confirmed against sqlx 0.8's public API)
use sqlx::sqlite::SqliteJournalMode;
use std::time::Duration;

pub async fn build_pool(db_url: &str) -> anyhow::Result<sqlx::SqlitePool> {
    let db_opts: SqliteConnectOptions = db_url
        .parse::<SqliteConnectOptions>()
        .context("invalid PV_DB_URL")?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let db = SqlitePoolOptions::new().max_connections(8).connect_with(db_opts).await.context("db connect")?;
    sqlx::migrate!("./migrations").run(&db).await.context("migrations")?;
    Ok(db)
}
```
Note: `sqlx`'s own default `busy_timeout` is already 5 seconds even if unset (confirmed via websearch/docs.rs) — the explicit call here is about making the value visible/intentional in this codebase's own source, and about pairing it correctly with WAL mode (which is the setting genuinely absent today), not fixing an actual timeout-value bug.

### SIGTERM-aware graceful shutdown
```rust
// Source: standard tokio::signal::unix pattern for container-aware shutdown
// (this crate already depends on tokio with the "signal" feature enabled —
// crates/pv-server/Cargo.toml confirmed: tokio = { version = "1", features
// = ["macros", "rt-multi-thread", "signal"] } — no new dependency needed)
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        let mut sig = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler");
        sig.recv().await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
    tracing::info!("shutting down");
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Nginx/Apache serving static files + reverse-proxying to a separate app process (2 processes, 1 container) | A single Rust binary serving both API and static export via `tower-http::ServeDir` | This project's own Area 2 decision, not an industry-wide shift | Avoids the classic "2 processes wedged into 1 container via supervisord" anti-pattern this project's "1 kontener" positioning explicitly rejects |
| Manual `SIGTERM`-unaware shutdown ("just `docker kill` eventually") | Explicit `tokio::signal::unix::signal(SignalKind::terminate())` handling for graceful drains | Standard Rust/tokio containerization practice, not new this year | Directly relevant to this phase's sync WebSocket connections, which benefit from a clean close rather than an abrupt reset on every deploy |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `debian:bookworm-slim` has neither `curl` nor `wget` preinstalled | Standard Stack / Pitfall 5 | Low — worst case, the Dockerfile's `apt-get install wget` line is a harmless no-op if it turns out to already be present; the inverse assumption (assuming it's present when it's not) is the actually risky direction, which this research avoids |
| A2 | Caddy's `log { format filter { fields { uri query { delete token } } } }` nesting is the exact current Caddyfile syntax | Pattern 5 | Medium — Caddyfile directive syntax has real version-to-version drift; the planner should run `caddy validate` (or `caddy fmt`) against the actual installed/documented Caddy version before shipping this as a tested reference config, not just a plausible one |
| A3 | `url` crate is transitively available via `webauthn-rs`'s own dependency tree at the version needed for `Config::validate()`'s parsing | Pattern 3 | Low — even if not transitively reachable as a direct import, adding `url = "2"` as an explicit `[workspace.dependencies]` entry is a trivial, zero-risk addition; worth confirming via `cargo tree -p pv-server -i url` at implementation time |
| A4 | `node:20-slim` is compatible with Next.js 16.2.10 (per `web/package.json`) | Standard Stack | Low — Next.js 16 targets current Node LTS; a mismatch would surface immediately and loudly at `npm run build` time in CI/local testing before ever reaching a shipped image |

**If this table is empty:** N/A — see entries above; all four are either self-correcting-if-wrong (A1, A3) or cheaply verifiable before shipping (A2, A4).

## Open Questions (RESOLVED)

1. **Does the web build actually depend on a pre-built WASM artifact at build time, not just runtime?**
   - What we knew: CONTEXT.md's Area 1 flagged `web/package.json`'s `predev`/`prebuild` hooks as something to "check."
   - Resolution: **Verified this session.** `web/package.json`'s `"prebuild": "bash ../scripts/build-wasm.sh"` runs before every `next build`; `scripts/build-wasm.sh` compiles `pv-wasm` for `wasm32-unknown-unknown`, runs `wasm-bindgen`, and moves outputs into `web/public/wasm/` + `web/src/lib/crypto/wasm/` — both paths the Next.js static export's client bundle imports from at build time. This is Pattern 1/Pitfall 1 above, the single most important build-ordering fact in this research.

2. **What exact `sqlx` API sets WAL mode and a busy timeout?**
   - What we knew: CONTEXT.md named the concept ("WAL journal mode + a `busy_timeout`") without the exact method names.
   - Resolution: **Resolved.** `SqliteConnectOptions::journal_mode(SqliteJournalMode::Wal)` and `.busy_timeout(Duration)`, both chainable builder methods (docs.rs, verified). `sqlx`'s own unset default is already a 5-second busy timeout — WAL mode is the setting genuinely absent and worth adding.

3. **Does `main.rs`'s current shutdown handling actually respond to `docker stop`?**
   - What we knew: CONTEXT.md's Area 7/general framing mentioned "graceful shutdown (SIGTERM → axum graceful)" as something to research, without confirming the current code's behavior.
   - Resolution: **Resolved, and found to be a real gap.** Current `shutdown_signal()` only awaits `tokio::signal::ctrl_c()` (SIGINT). `docker stop`'s default signal is SIGTERM, which is never trapped today — see Pitfall 4. This phase should fix this, not just document Docker's healthcheck/stop behavior around it.

4. **Does `debian:bookworm-slim` ship a usable `HEALTHCHECK` HTTP client out of the box?**
   - What we knew: CONTEXT.md deferred the exact tool choice to "whatever's already present in the chosen base image."
   - Resolution: **Resolved: nothing is present.** Neither `curl` nor `wget` ships on `debian:bookworm-slim` — an explicit `apt-get install --no-install-recommends wget` (or a `pv-server --healthcheck` CLI mode avoiding the extra package entirely) is required; see Pitfall 5.

5. **What's the real, version-current mechanism for stripping a query param from a reverse proxy's access log (WR-02's proxy-side half)?**
   - What we knew: CONTEXT.md described the *goal* (strip `?token=...`) and sketched plausible approaches (custom `log_format` for nginx, per-matcher `log` scoping for Caddy) without confirming exact, current directive syntax.
   - Resolution: **Resolved for Caddy** (Pattern 5): the `log { format filter { fields { uri query { delete <key> } } } }` shape is a real, purpose-built mechanism added specifically for this class of problem (websearch-confirmed against Caddy's own changelog/docs, `[CITED, MEDIUM confidence — see A2]`). **Resolved for nginx** (Pattern 4/Pitfall 3): nginx has no equivalent per-param primitive; the practical reference-config answer is to log `$uri` (dropping the whole query string) for the one route that matters, not attempt a per-param nginx equivalent.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Docker / `docker compose` | Building and running the packaged image locally to verify this phase | Assumed present on the implementer's machine (not verified this session — no Docker daemon probe run) | — | If unavailable locally, the Dockerfile/compose files can still be written and reviewed textually, but the phase's own success criteria (an actual `docker run` end-to-end) require it — flag as a hard blocker to verification, not implementation |
| `rust-toolchain.toml`'s pinned channel + `wasm32-unknown-unknown` target | Dockerfile builder stage 1 | ✓ (already required by every prior phase's local dev loop) | `stable` channel per `rust-toolchain.toml` (read this session) | — |
| A real Caddy/nginx binary for local reverse-proxy testing | Verifying Area 6's reference configs actually work, not just parse | Not verified this session (no proxy installed/probed) — recommend `docker compose` service definitions for both proxies in a test-only compose override, so verification doesn't require host-level nginx/Caddy installs | Caddy/nginx official Docker images (`caddy:2`, `nginx:1-alpine`) | Use the official images as compose services rather than requiring host installs — simpler, more reproducible or CI-friendly |

**Missing dependencies with no fallback:** none — Docker itself is the only hard external requirement, and it's this entire phase's subject matter, not an incidental tool.

**Missing dependencies with fallback:** reverse-proxy binaries for local verification (fallback: dockerized `caddy`/`nginx` images as compose test services, avoiding a host-level install requirement).

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework (Rust) | `cargo test` (native target) for `pv-server`'s `config`/`main` unit and integration tests — existing `mod tests` convention |
| Framework (container/E2E) | No existing framework — this phase should add a `docker compose -f docker-compose.yml -f docker-compose.test.yml` (or a shell script) that builds the image, starts it + a proxy service, and runs `curl`/`websocat` assertions against it; no prior art in this repo to extend, so this is new test infrastructure |
| Quick run command (Rust) | `cargo test -p pv-server config::` / `cargo test -p pv-server --test config_validate` |
| Full suite command | `cargo test --workspace` (unchanged) + a new manual/scripted container-level smoke test (see below) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| DEPLOY-02 | `Config::validate()` decision table: localhost exception passes untouched; non-localhost + missing scheme fails named; non-localhost + http fails named; `rp_id`/`rp_origin` host mismatch fails named | unit (Rust) | `cargo test -p pv-server config::validate` | ❌ Wave 0 — new tests in `crates/pv-server/src/config.rs`'s own `mod tests` (mirroring `lib.rs`'s existing `build_webauthn_*` test pair) |
| DEPLOY-01 | `router()` with a real static dir serves `index.html` for an unmatched client-side route (SPA fallback) and still serves `/api/healthz`/API routes correctly | integration (Rust) | `cargo test -p pv-server --test router_static_fallback` (new) | ❌ Wave 0 |
| DEPLOY-01 | `router()` with `static_dir: None` (today's existing test harness shape) still works — no regression | integration (Rust) | existing `crates/pv-server/tests/*.rs` suite, unchanged | ✓ (regression check only) |
| DEPLOY-01 | Container-level: `docker build .` succeeds; `docker run` serves `/healthz`, `/`, and an API route on one port; `docker stop` exits within a few seconds (not the full 10s SIGKILL timeout) — proves the SIGTERM fix | manual/scripted E2E | new `scripts/verify-container.sh` (or documented manual steps in `docs/SELF-HOSTING.md`) | ❌ Wave 0 — no container-level test infra exists yet in this repo |
| DEPLOY-01 (proxy criterion) | Passkey registration/login + `/api/sync/ws` work end-to-end behind a dockerized nginx **and** a dockerized Caddy, fronting the packaged container | manual/scripted E2E (Playwright against a proxied URL, per this project's existing UAT convention) | new, documented manual UAT steps — no existing automated harness for this | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted `cargo test -p pv-server <module>::` for the file just touched.
- **Per wave merge:** `cargo test --workspace` + (if a container test script exists by then) one container-level smoke run.
- **Phase gate:** Full `cargo test --workspace` green, `docker build .` succeeds, and at least one proxy (nginx or Caddy) verified end-to-end per `/gsd-verify-work`'s Playwright-UAT convention (both should be checked before calling ROADMAP's success criterion #3 fully met).

### Wave 0 Gaps
- [ ] `crates/pv-server/src/config.rs`'s `mod tests` — `Config::validate()` decision table (localhost exception, missing scheme, http-not-https, host mismatch)
- [ ] `crates/pv-server/tests/router_static_fallback.rs` (or similar) — SPA fallback behavior with a real temp directory standing in for `web/out/`
- [ ] `crates/pv-server/src/main.rs`'s existing `mod tests` — extend with a `shutdown_signal` structural test if feasible (signal-handling itself is hard to unit test meaningfully; a doc-comment + manual verification via `docker stop` timing may be the pragmatic choice here, not a forced unit test)
- [ ] `scripts/verify-container.sh` or equivalent documented manual steps — no container-level test framework exists in this repo yet; this phase is the first to need one
- [ ] Framework install: none for the Rust-side tests (existing `cargo test` fully configured); the container/E2E test surface is genuinely new infrastructure this phase must decide the shape of (script vs. manual doc steps) — flagged as a plan-time decision, not resolved here

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V1 Architecture | Yes | Single-container, single-origin deployment removes an entire class of cross-origin misconfiguration risk that a split web/API-origin deployment would carry (already noted by `routes/mod.rs`'s own CORS doc comment) |
| V2 Authentication | No | Phase 7 adds no new auth surface |
| V5 Input Validation | Yes | `Config::validate()` is itself an input-validation control over environment-supplied configuration — DEPLOY-02's entire purpose |
| V7 Error Handling / Logging | Yes | Reverse-proxy access-log token stripping (WR-02 closure) is exactly a V7 concern: sensitive session tokens must never persist in a log sink outside the application's own control |
| V9 Communications | Yes | TLS termination policy (always the reverse proxy's job, never pv-server's) is a V9-relevant architectural decision this phase documents explicitly |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Operator sets `PV_ORIGIN`/`PV_RP_ID` to a plausible-looking but incoherent pair (e.g. `PV_RP_ID=vault.example.com` + `PV_ORIGIN=https://app.example.org`), discovers the mismatch only when a real user's passkey registration silently fails with a browser-level `SecurityError` | Tampering (misconfiguration, not malicious) / Denial of Service (of the passkey feature specifically) | `Config::validate()`'s fail-fast startup check (DEPLOY-02) — the server refuses to start at all rather than starting in a broken state discoverable only by an end user |
| Reverse-proxy access logs (nginx/Caddy, outside pv-server's own process/log sink) persist live session bearer tokens from `/api/sync/ws?token=...` on disk, readable by anyone with log-file access (log aggregation pipelines, `logrotate` archives, etc.) | Information Disclosure | Both reference configs (Pattern 4/5) strip or drop the query string for this one route — this is the proxy-side half of the mitigation `main.rs`'s `make_span` already implements server-side (WR-02) |
| A misconfigured/absent `HEALTHCHECK` causes an orchestrator (Docker Swarm/Kubernetes/a self-hoster's own restart-on-unhealthy tooling) to never detect a genuinely wedged process, or conversely to flap-restart a healthy one because the healthcheck tool itself is missing (Pitfall 5) | Denial of Service (operational, not attacker-driven) | Explicit, verified-present healthcheck tooling in the runtime image (Pitfall 5's resolution) |
| An abrupt SIGKILL (from a graceful-shutdown gap, Pitfall 4) drops in-flight sync WebSocket connections mid-write, potentially truncating a client's view of a partially-synced batch | Tampering (data-integrity-adjacent, not confidentiality) | SIGTERM-aware `shutdown_signal()` (Code Examples) lets `axum::serve`'s graceful-shutdown drain in-flight connections/requests cleanly before process exit |

## Sources

### Primary (HIGH confidence)
- Direct codebase reads: `crates/pv-server/src/config.rs`, `crates/pv-server/src/main.rs`, `crates/pv-server/src/lib.rs`, `crates/pv-server/src/routes/mod.rs`, `crates/pv-server/Cargo.toml`, `Cargo.toml` (workspace), `rust-toolchain.toml`, `scripts/build-wasm.sh`, `web/next.config.ts`, `web/package.json`, `web/src/lib/auth/api.ts`, `web/src/lib/vault/sync.ts`, `README.md`, `crates/pv-server/migrations/` directory listing, `07-CONTEXT.md` (this phase's own locked decisions)
- `cargo tree -p pv-server -i sqlx` (confirms `sqlx v0.8.6` resolved version)

### Secondary (MEDIUM-HIGH confidence)
- `docs.rs/tower-http` `ServeDir`/`ServeFile` pages + `tokio-rs/axum` GitHub discussions #3206/#2418/#867 (websearch) — `not_found_service`/SPA-fallback pattern
- `docs.rs/sqlx` `SqliteConnectOptions` page + Evan Schwartz's "PSA: Your SQLite Connection Pool Might Be Ruining Your Write Performance" (websearch) — `journal_mode`/`busy_timeout` builder API, default busy-timeout value
- Caddy's official `logging` module docs + Kévin Dunglas's "New in Caddy 2.5: Redact Sensitive Data from Your Logs" + the `#4424` commit adding the query filter (websearch, cross-referenced across 2 independent sources) — `query { delete/replace/hash }` log filter shape

### Tertiary (LOW-MEDIUM confidence)
- nginx per-location query-string log stripping (websearch, general guides — no single authoritative nginx.org doc page found matching this exact recipe; the `$uri`-vs-`$request` distinction itself is HIGH confidence, but the specific "scope a `log_format` to one location" recipe is this research's own synthesis, not a directly cited nginx.org example)
- `debian:bookworm-slim`'s lack of `curl`/`wget` (websearch, general minimal-image healthcheck guides — no single Docker Hub page enumerating `bookworm-slim`'s exact package manifest was fetched this session; recommend a throwaway `docker run --rm debian:bookworm-slim which wget curl` sanity check at implementation time to convert this from MEDIUM to HIGH confidence at near-zero cost)

## Metadata

**Confidence breakdown:**
- Codebase-grounded findings (WASM build ordering, SIGTERM gap, existing config/router/lib.rs shapes): HIGH — every claim traced to a specific file read this session, not training-data recall
- Library API shapes (`tower-http::ServeDir`, `sqlx::SqliteConnectOptions`): HIGH — verified via docs.rs-sourced websearch results describing the exact current public API
- Reverse-proxy directive syntax (nginx `log_format` scoping, Caddy `query` log filter nesting): MEDIUM — real, cited mechanisms, but exact syntax should be validated against the operator's actual installed proxy version (`caddy validate`, `nginx -t`) before treating the reference configs as "tested," not just "written"
- Docker base-image package contents (`debian:bookworm-slim` lacking `curl`/`wget`): MEDIUM — standard, widely-corroborated knowledge, cheap to verify directly at implementation time with a throwaway container run

**Research date:** 2026-07-14
**Valid until:** 30 days for library API shapes (stable, versioned); ~14 days for reverse-proxy directive syntax specifics if either nginx or Caddy has a minor release in that window (low likelihood of a breaking syntax change, but directive nesting has drifted before in Caddy's history per Assumption A2) — the planner should re-run `caddy validate`/`nginx -t` at implementation time regardless of how much time has passed, since this is a near-zero-cost check.
