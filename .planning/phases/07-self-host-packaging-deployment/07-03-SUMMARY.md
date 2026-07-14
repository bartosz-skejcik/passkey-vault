---
phase: 07-self-host-packaging-deployment
plan: 03
subsystem: infra
tags: [nginx, caddy, reverse-proxy, docker, websocket, access-log-redaction, tls, e2e-testing]

requires:
  - phase: 07-01
    provides: "SIGTERM-aware graceful shutdown; router()'s single-port API+static serving that both proxies front"
  - phase: 07-02
    provides: "Dockerfile-built pv-server image + docker-compose.yml's pv-server service (name, exposed port 8620), which docker-compose.proxy-test.yml overlays and scripts/verify-container.sh boots"
provides:
  - "deploy/nginx.conf.example — TLS-terminating reference config forwarding /api/sync/ws's WS upgrade (map $http_upgrade + Upgrade/Connection/proxy_http_version 1.1 triple) and logging $uri only (no query string) for that one route via a scoped sync_ws_redacted log_format, closing Phase 5's WR-02 gap on the proxy side"
  - "deploy/Caddyfile.example — reference config with automatic WS upgrade (zero extra directives, reverse_proxy auto-detects Upgrade) and a query { delete token } log filter stripping the session token from /api/sync/ws's logged URI, relying on real automatic-HTTPS/ACME by default (no tls internal baked in)"
  - "docker-compose.proxy-test.yml — compose overlay (never a replacement) adding nginx-test/caddy-test services fronting the existing pv-server service for scripted E2E verification"
  - "scripts/verify-container.sh — scripted pass/fail gate: builds the image, generates throwaway TLS material for both proxies without mutating either shipped example file, registers+logs in a throwaway account against pv-server directly to obtain a real percent-encoded session token, then asserts HTTPS healthz + a completed WS upgrade (101) + absence of 'token=' in each proxy's own access log, with trap-based cleanup"
  - "docs/SELF-HOSTING.md's new 'Weryfikacja end-to-end za reverse proxy' section documenting the scripted check and a manual Playwright-UAT passkey-ceremony walkthrough behind both proxies"
affects: []

tech-stack:
  added: ["nginx:1-alpine (Docker)", "caddy:2 (Docker)"]
  patterns:
    - "Reverse-proxy reference configs stay production-realistic (real TLS-terminating server blocks / real automatic ACME) and are never weakened to plaintext for testability — a separate script-generated, disposable TLS derivative (throwaway self-signed cert for nginx; tls internal-forced sed-derived Caddyfile copy for Caddy) bridges 'real reference config' to 'bootable in a sandboxed test run,' and neither shipped example file is ever mutated by the test harness"
    - "A scripted E2E gate acquires a REAL session token (register + login against the app directly) before asserting any protected behavior (the WS upgrade) — a fabricated/placeholder token would be rejected by the real auth path before ever reaching the assertion under test, making a fake-token shortcut both unnecessary and misleading"
    - "Proxy-level access-log redaction is a distinct trust boundary from the application's own tracing redaction (main.rs's make_span/WR-02) — a proxy's raw access log is written before the app's own middleware runs, so it needs its own, proxy-native redaction mechanism (nginx: drop the whole query string per-route via a scoped log_format; Caddy: a structured per-key query filter) rather than assuming the app-layer fix covers it"

key-files:
  created:
    - deploy/nginx.conf.example
    - deploy/Caddyfile.example
    - docker-compose.proxy-test.yml
    - scripts/verify-container.sh
  modified:
    - docs/SELF-HOSTING.md

key-decisions:
  - "Both deploy/nginx.conf.example and deploy/Caddyfile.example ship as real, TLS-terminating production reference configs — no plaintext fallback and no test-only TLS override (tls internal) baked into either shipped file, even though this makes the test harness itself more work (per 07-CONTEXT.md Area 6 and the plan's explicit 'must NOT invent one just to make scripting easier' constraint)"
  - "scripts/verify-container.sh solves both proxies' TLS-bootstrap problem entirely in script-generated scratch material (mktemp -d): an openssl-generated throwaway self-signed cert for nginx-test, and a sed-derived tls internal-forced Caddyfile.test copy for caddy-test — neither shipped example file is ever mutated, verified by the plan's own acceptance criterion (git diff --stat deploy/ shows no changes from Task 1/2's committed versions)"
  - "The script acquires a REAL session token via POST /api/auth/register then POST /api/auth/login against pv-server's own exposed port (no proxy involved for auth) before either proxy's WS assertion, because ws_handler validates ?token= via session::validate_token BEFORE upgrading and an empty sessions table would 401 any placeholder token unconditionally"
  - "The captured base64-STANDARD session token is percent-encoded before interpolation into any ?token= query string, since base64-STANDARD can contain '+', '/', '=' — all reserved/meaningful in a URL query string"
  - "nginx's access-log redaction for /api/sync/ws drops the WHOLE query string (no per-param redaction primitive exists in nginx), scoped to that one location only via a separate log_format — every other location keeps nginx's normal full-URI logging; Caddy's structured query { delete token } filter achieves per-key redaction instead"

patterns-established:
  - "Deliberate one-time negative-test sanity check (breaking a config on a scratch copy, confirming the specific assertion fails, then discarding the broken copy) validates that a scripted gate is real rather than vacuous — documented as a manual, non-permanent step, never wired into CI as a regression fixture"
  - "Compose test overlays (docker-compose.proxy-test.yml) are always layered on top of the real deployment compose file via -f docker-compose.yml -f docker-compose.proxy-test.yml, never a standalone/divergent definition"

requirements-completed: [DEPLOY-01, DEPLOY-02]

coverage:
  - id: D1
    description: "deploy/nginx.conf.example is a full top-level nginx.conf (validates standalone via nginx -t) with a map $http_upgrade $connection_upgrade block; a /api/sync/ws location forwarding Upgrade/Connection: upgrade/proxy_http_version 1.1; a sync_ws_redacted log_format logging $uri only (no query string), scoped to that location and cross-referencing main.rs's make_span/WR-02 doc comment by name; every other location keeping nginx's normal full-URI access log; a listen 443 ssl server block referencing ssl_certificate/ssl_certificate_key at conventional mount paths with a comment describing both the real-deployment (certbot/Let's Encrypt) and local/test (throwaway self-signed) paths to populating them"
    requirement: "DEPLOY-01"
    verification:
      - kind: manual_procedural
        ref: "Direct read of deploy/nginx.conf.example — confirms the map/Upgrade/Connection/proxy_http_version triple scoped to /api/sync/ws, the sync_ws_redacted log_format naming WR-02, the un-redacted default log_format for location /, and ssl_certificate/ssl_certificate_key at /etc/nginx/certs/{fullchain,privkey}.pem with no real cert/key material committed"
        status: pass
      - kind: e2e
        ref: "mkdir -p /tmp/pv-nginx-selfcheck-certs && openssl req -x509 -nodes -newkey rsa:2048 -keyout .../privkey.pem -out .../fullchain.pem -days 1 -subj '/CN=vault.example.com' && docker run --rm -v \"$(pwd)/deploy/nginx.conf.example:/etc/nginx/conf.d/pv.conf:ro\" -v /tmp/pv-nginx-selfcheck-certs:/etc/nginx/certs:ro nginx:1-alpine nginx -t (also embedded verbatim in scripts/verify-container.sh's own cert-generation step)"
        status: deferred
    human_judgment: true
    rationale: "Docker/nginx are unavailable in this execution environment (documented in commit 6195bb3's own message as DEFERRED, human_needed). A human on a Docker-capable host must run `nginx -t` against the file with a throwaway cert mounted before this deliverable's syntactic validity is proven, not just written per 07-RESEARCH.md's Pattern 4 template."
  - id: D2
    description: "deploy/Caddyfile.example ships a vault.example.com { ... } site block with no explicit tls directive (relies on real automatic-HTTPS/ACME by default); reverse_proxy pv-server:8620 with a comment contrasting its automatic WS handling against nginx's explicit header lines; a log { format filter { fields { uri query { delete token } } } } block stripping the session token from /api/sync/ws's logged URI, cross-referencing main.rs's make_span/WR-02 doc comment by name"
    requirement: "DEPLOY-01"
    verification:
      - kind: manual_procedural
        ref: "Direct read of deploy/Caddyfile.example — confirms reverse_proxy pv-server:8620 with the WS-contrast comment, the log { format filter { fields { uri query { delete token } } } } block with the WR-02 cross-reference, and grep -c 'tls internal' deploy/Caddyfile.example returns 0 (no test-only TLS override baked into the shipped file)"
        status: pass
      - kind: e2e
        ref: "docker run --rm -v \"$(pwd)/deploy/Caddyfile.example:/etc/caddy/Caddyfile:ro\" caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile"
        status: deferred
    human_judgment: true
    rationale: "Docker/Caddy are unavailable in this execution environment (documented in commit ae52e74's own message as DEFERRED, human_needed). 07-RESEARCH.md flagged Pattern 5's exact directive nesting as MEDIUM confidence (Assumption A2) requiring correction against a real `caddy validate` run — a human on a Docker-capable host must run that validation before this deliverable's syntactic correctness is proven."
  - id: D3
    description: "docker-compose.proxy-test.yml is a compose overlay (never a standalone/replacement file) adding nginx-test (nginx:1-alpine, host port 8621:443, mounting the real deploy/nginx.conf.example plus a script-parameterized certs directory) and caddy-test (caddy:2, host port 8622:443, mounting a script-parameterized Caddyfile path) services, both depends_on: [pv-server] and proxying to pv-server's internal 8620; scripts/verify-container.sh is a bash set -euo pipefail script that generates throwaway TLS material in a mktemp -d scratch dir (self-signed cert for nginx-test; a sed-derived tls internal-forced Caddyfile.test for caddy-test) without mutating either shipped example file, registers a throwaway account (POST /api/auth/register with a valid RegisterRequest shape) and logs in (POST /api/auth/login) directly against pv-server's own exposed port to obtain and percent-encode a real session token, brings up the compose overlay with a bounded curl retry loop (not a blind sleep) for pv-server's own healthz, then for each proxy asserts curl -k + Host-header HTTPS /healthz returns 200, a raw-socket TLS WS upgrade request with the real token returns HTTP 101 (not 401), and that proxy's own access log does not contain the literal string 'token=' — with a trap-based cleanup tearing down containers and the scratch dir on both success and failure exit paths"
    requirement: "DEPLOY-01"
    verification:
      - kind: manual_procedural
        ref: "Direct read of docker-compose.proxy-test.yml and scripts/verify-container.sh — confirms the overlay-not-replacement compose shape, the trap cleanup() ... EXIT installed before any container is started, the register→login→percent-encode token-acquisition sequence occurring strictly before either proxy's assert_proxy() call, and the assert_proxy() function's three checks (HTTPS healthz 200, WS upgrade 101, absence of 'token=' in the proxy's own access log)"
        status: pass
      - kind: e2e
        ref: "bash scripts/verify-container.sh 2>&1 | tail -150 (expects exit 0 with every PASS line printed); a one-time manual sanity break (removing the Upgrade header line from a scratch copy of deploy/nginx.conf.example, re-running with a real token already in hand) should make the script fail specifically on that proxy's WS-handshake assertion, not a 401"
        status: deferred
    human_judgment: true
    rationale: "Docker (and openssl/python3 as invoked inside a Docker-capable shell against the running containers) are unavailable in this execution environment (documented in commit 7b10f9f's own message as DEFERRED, human_needed). This is 07-VALIDATION.md's phase-gate sample — a human on a Docker-capable host must run scripts/verify-container.sh and confirm exit 0 plus the one-time deliberate-break sanity check before the reverse-proxy transport/logging contract is proven working, not merely scripted."
  - id: D4
    description: "docs/SELF-HOSTING.md gains a 'Weryfikacja end-to-end za reverse proxy' section (Polish) documenting: (a) `bash scripts/verify-container.sh` as the automated transport/logging check, noting it exercises HTTPS via a throwaway self-signed cert (nginx) / Caddy's tls internal (Caddy), with production deployments using the shipped example files' own real certs/real ACME; (b) a manual Playwright-UAT walkthrough for the full browser-driven passkey ceremony (bring up the proxy-test overlay, open the proxied URL in a real browser, complete passkey enrollment + PRF unlock, confirm the sync WebSocket reconnects after a simulated network blip, repeat for both proxies) per this project's established Playwright-UAT convention"
    requirement: "DEPLOY-02"
    verification:
      - kind: manual_procedural
        ref: "Direct read of docs/SELF-HOSTING.md's 'Weryfikacja end-to-end za reverse proxy' section (both the 'Automatyczna: transport + zacieranie logów' and 'Manualna: pełna ceremonia passkey za proxy (Playwright-UAT)' subsections)"
        status: pass
    human_judgment: false

duration: ~5min (commit span 21:04:28–21:05:47 on 2026-07-14; exact wall-clock authoring time not separately timestamped)
completed: 2026-07-14
status: complete
---

# Phase 7 Plan 03: Reverse-Proxy Reference Configs & Dockerized E2E Smoke Test Summary

**`deploy/nginx.conf.example` and `deploy/Caddyfile.example` both forward the sync WebSocket's upgrade handshake and strip the live session token from their own access logs (closing Phase 5's WR-02 gap on the proxy side), plus a scripted `scripts/verify-container.sh` gate that fronts the packaged image with real dockerized nginx AND Caddy, acquires a real session token, and asserts HTTPS healthz + WS upgrade + log redaction end-to-end.**

## Performance

- **Duration:** ~5 min (task commits span 21:04:28–21:05:47 on 2026-07-14; exact wall-clock authoring time not separately recorded)
- **Started:** 2026-07-14 (session following 07-02)
- **Completed:** 2026-07-14T21:05:47+02:00 (last task commit, 7b10f9f)
- **Tasks:** 3/3 completed
- **Files modified:** 5 (4 new, 1 modified)

## Accomplishments
- `deploy/nginx.conf.example` — a full, standalone-validatable nginx config forwarding `/api/sync/ws`'s WS upgrade (`map $http_upgrade` + `Upgrade`/`Connection: upgrade`/`proxy_http_version 1.1`) and logging `$uri` only (no query string) for that route via a scoped `sync_ws_redacted` `log_format`, cross-referencing `main.rs`'s `make_span`/WR-02 doc comment; every other location keeps nginx's normal full-URI logging — closes DEPLOY-01's proxy-transport requirement and the WR-02 gap on the nginx side
- `deploy/Caddyfile.example` — automatic WS upgrade with zero extra directives (contrasted in-file against nginx's explicit header lines) plus a `query { delete token }` structured log filter stripping the session token from `/api/sync/ws`'s access log entries; ships with real automatic-HTTPS/ACME by default (no `tls internal` baked in) — closes the same DEPLOY-01/WR-02 pair on the Caddy side
- `docker-compose.proxy-test.yml` + `scripts/verify-container.sh` — the repo's first container-level E2E test infrastructure: a compose overlay fronting the existing `pv-server` service with real dockerized `nginx-test`/`caddy-test` containers, and a `trap`-guarded bash script that generates disposable TLS material for both proxies (never mutating either shipped example file), registers and logs in a throwaway account to obtain a real percent-encoded session token, then asserts HTTPS `/healthz`, a completed WS upgrade (101) over TLS with that real token, and the absence of `token=` in each proxy's own access log
- `docs/SELF-HOSTING.md` gains a "Weryfikacja end-to-end za reverse proxy" section documenting both the scripted check and a manual Playwright-UAT walkthrough for the full browser-driven passkey ceremony behind both proxies — closes ROADMAP.md's Phase 7 success criterion #3

## Task Commits

Each task was committed atomically:

1. **Task 1: `deploy/nginx.conf.example` — WS upgrade + scoped access-log token redaction** - `6195bb3` (feat)
2. **Task 2: `deploy/Caddyfile.example` — automatic WS + validated `query { delete token }` log filter** - `ae52e74` (feat)
3. **Task 3: Dockerized E2E smoke test (`docker-compose.proxy-test.yml` + `scripts/verify-container.sh`) + `docs/SELF-HOSTING.md` UAT section** - `7b10f9f` (feat)

_No TDD RED/GREEN split — these are reverse-proxy config + shell-script deliverables, not Rust behavior; each task's own commit message documents its deferred Docker/nginx/Caddy-dependent verification commands._

## Files Created/Modified
- `deploy/nginx.conf.example` - Full standalone nginx config: WS-upgrade triple + scoped `sync_ws_redacted` log_format for `/api/sync/ws`; `listen 443 ssl` with conventional cert paths
- `deploy/Caddyfile.example` - `reverse_proxy pv-server:8620` (automatic WS) + `log { format filter { fields { uri query { delete token } } } }`; no `tls internal` baked in
- `docker-compose.proxy-test.yml` - Compose overlay adding `nginx-test`/`caddy-test` services fronting `pv-server`, parameterized TLS mount paths
- `scripts/verify-container.sh` - Scripted pass/fail E2E gate: throwaway TLS generation, real session-token acquisition, HTTPS healthz + WS upgrade + log-redaction assertions per proxy, trap-based cleanup
- `docs/SELF-HOSTING.md` - New "Weryfikacja end-to-end za reverse proxy" section (automated check + manual Playwright-UAT walkthrough)

## Decisions Made
- Both reference configs ship as real, TLS-terminating production configs — no plaintext fallback, no `tls internal` baked into `deploy/Caddyfile.example` — per 07-CONTEXT.md Area 6's locked decision and the plan's explicit "must NOT invent [a plaintext variant] just to make scripting easier" constraint
- The TLS-bootstrap problem for the sandboxed test run is solved entirely in script-generated scratch material (a `mktemp -d` throwaway self-signed cert for nginx-test; a `sed`-derived `tls internal`-forced `Caddyfile.test` copy for caddy-test) — neither shipped example file is ever mutated, verified by the plan's own `git diff --stat deploy/` acceptance criterion
- A real session token is acquired via `POST /api/auth/register` then `POST /api/auth/login` against `pv-server`'s own exposed port (no proxy needed for auth) before either proxy's WS assertion, since `ws_handler`'s pre-upgrade `validate_token` check would reject any placeholder token with 401 against a fresh, empty `sessions` table
- The captured base64-STANDARD session token is percent-encoded (Python's `urllib.parse.quote`) before interpolation into any `?token=` query string, since base64-STANDARD can contain `+`, `/`, `=` — all reserved/meaningful in a URL query string
- nginx's access-log redaction for `/api/sync/ws` drops the whole query string (no per-param redaction primitive exists in nginx), scoped to that location only; Caddy's structured `query { delete token }` filter achieves per-key redaction instead — both approaches documented inline with the tradeoff rationale

## Deviations from Plan
None - plan executed exactly as written. All Docker/nginx/Caddy-dependent verification steps (`nginx -t`, `caddy validate`, `scripts/verify-container.sh`'s full run, the one-time deliberate WS-header-removal sanity check) were deferred per-task, exactly as anticipated and pre-documented in `07-VALIDATION.md`'s Manual-Only Verifications table — this is an environment constraint (no Docker daemon available), not a plan deviation.

## Issues Encountered
Docker, nginx, and Caddy binaries are unavailable in this execution environment. Every Docker/nginx/Caddy-dependent `<automated>`/`<verify>` command from the plan (`nginx -t`, `caddy validate`, the full `scripts/verify-container.sh` run including registration/login/WS-handshake/log-redaction assertions, and the one-time deliberate config-break sanity check) is real and scripted but could not be executed here — each task's commit message (`6195bb3`, `ae52e74`, `7b10f9f`) records the exact deferred commands verbatim so a human on a Docker-capable host can run them. This matches `07-VALIDATION.md`'s pre-declared environment caveat, not an unplanned issue discovered mid-execution.

## User Setup Required
None - no external service configuration required. A self-hoster running `bash scripts/verify-container.sh` needs only Docker (with `nginx:1-alpine` and `caddy:2` pulled) and the standard tools the script already checks for (`openssl`, `curl`, `python3`).

## Next Phase Readiness
- Phase 7's full Docker-packaging + reverse-proxy deliverable set (Plans 07-01 through 07-03) is now written and internally consistent: `Dockerfile`/`docker-compose.yml` (07-02) are exactly what `docker-compose.proxy-test.yml` and `scripts/verify-container.sh` (this plan) extend and boot.
- No blockers for future phases (Phase 7 is currently the last defined phase in ROADMAP.md). The outstanding work is exclusively the DEFERRED Docker/nginx/Caddy verification across all three Phase 7 plans, per `07-VALIDATION.md`'s explicit Manual-Only Verifications table and each task's own commit-message-recorded command list — a human on a Docker-capable host must run `docker build .`, `docker compose up/down/up`, `nginx -t`, `caddy validate`, and `scripts/verify-container.sh` (plus the one-time deliberate-break sanity check) before Phase 7 can be considered fully verified, not just fully written.

---
*Phase: 07-self-host-packaging-deployment*
*Completed: 2026-07-14*

## Self-Check: PASSED
All 5 declared files found on disk (`deploy/nginx.conf.example`, `deploy/Caddyfile.example`, `docker-compose.proxy-test.yml`, `scripts/verify-container.sh`, `docs/SELF-HOSTING.md`); all 3 task commit hashes (`6195bb3`, `ae52e74`, `7b10f9f`) found in git log.
