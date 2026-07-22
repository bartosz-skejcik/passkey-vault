---
phase: 07-self-host-packaging-deployment
uat_date: 2026-07-14
method: Rust/runtime self-verified, THEN full container + reverse-proxy E2E run on Colima (CLI Docker, no Desktop)
status: passed
result: ALL container/proxy E2E PASSED live — surfaced + fixed 6 real bugs in the process
---

# Phase 7 — UAT (container + reverse-proxy E2E, run live)

## ✅ RESULT (2026-07-14, updated): full container/proxy E2E PASSED on real Docker

Docker was later installed (Colima — CLI daemon, no Docker Desktop) and the entire
deferred checklist below was run for real. It **passed end-to-end**, but only after
surfacing and fixing **6 genuine bugs that code inspection could not catch** — the whole
point of running the real E2E:

| # | Bug | File | Fix (commit) |
|---|-----|------|--------------|
| 1 | **WR-02 SECURITY**: Caddy `query { delete token }` targeted field `uri`, but Caddy nests it at `request>uri` — filter matched nothing, session token **leaked into Caddy's access log** | `deploy/Caddyfile.example` | field path → `request>uri` (`a716f80`) |
| 2 | `docker build` failed — `openssl-sys` (webauthn-rs) needs OpenSSL; builder lacked `libssl-dev`, runtime lacked `libssl3` | `Dockerfile` | added build+runtime OpenSSL deps (`4e0ee37`) |
| 3 | BSD sed `a\` idiom breaks on macOS | `scripts/verify-container.sh` | → portable `awk` (`f6ae439`) |
| 4 | `mktemp` scratch in `/var/folders` not shared into macOS Docker VMs → bind-mount fails | `scripts/verify-container.sh` | repo-local scratch (`f6ae439`) |
| 5 | nested `-d "$(python3 -c "…")"` → brace-expansion mangled the JSON body | `scripts/verify-container.sh` | build body in a var (`f6ae439`) |
| 6 | `cat`-ing nginx's stdout-symlinked access.log hung forever; Caddy SNI cert selection needs `--resolve` not `-H Host:` | `scripts/verify-container.sh` | `compose logs` + `--resolve` (`f6ae439`) |

**Verified live (both directly and via `scripts/verify-container.sh`, exit 0):**
- `docker build` → 168MB image; runtime stage has no cargo/node/npm/rustc.
- Container serves `/healthz` (`{"status":"ok"}`), static `/` (200), SPA fallback `/some/route` (200 — the `ServeDir::fallback` deviation), and `/api/*` on one port.
- `docker stop` → graceful SIGTERM exit in **1s** (not the 10s SIGKILL grace).
- `compose down`/`up` recreation preserves the named `pv_data` volume — `pv.db` + `pv.db-wal` + `pv.db-shm` survive (WAL mode confirmed live).
- **Both nginx AND Caddy**: HTTPS healthz 200, `/api/sync/ws` WS upgrade 101 with a real session token, and **no `token=` in either proxy's access log (WR-02 closure proven for both)**.

Still genuinely manual (needs a browser + authenticator, per project convention): the full
passkey register + PRF-unlock + sync ceremony behind a proxy — a Playwright-UAT item.

---

## Original deferred checklist (now executed — kept for reference)

Phase 7's Rust surface and the fail-loud misconfig behavior were verified in this
autonomous run (see `07-VERIFICATION.md`): full `cargo test --workspace` green (incl.
new `router_static_fallback` + 8 `config::validate` cases), and live runtime UAT of
`Config::validate()` (incoherent PV_RP_ID/PV_ORIGIN → loud named-value failure; coherent
config → boots + graceful API-only degradation).

**Docker, nginx, and caddy binaries are unavailable in the autonomous environment**, so the
container-build and reverse-proxy end-to-end checks below could not be executed here. They
are NOT phase defects — every artifact is code-verified correct by inspection. Run these on
any Docker-capable host before a production self-host deploy. Each is copy-pasteable.

## Container build & runtime (DEPLOY-01)

```bash
# 1. Single self-contained image builds from a clean checkout
docker build -t pv-server-test .

# 2. Runtime stage carries no build toolchain (all must print not-found)
docker run --rm pv-server-test sh -c 'which cargo node npm rustc; echo exit=$?'

# 3. Container serves API + static on one port
docker run --rm -d --name pv-test -p 8620:8620 pv-server-test
curl -sf http://127.0.0.1:8620/healthz            # expect {"status":"ok"}
docker stop pv-test                                # expect exit within a few seconds (SIGTERM), not ~10s SIGKILL
```

## Volume persistence (DEPLOY-01)

```bash
cp .env.example .env
docker compose config                              # parses cleanly (default + customized .env)
docker compose up -d && sleep 5 && curl -sf http://127.0.0.1:8620/healthz
docker compose down                                # container removed, named volume pv_data retained
docker compose up -d && sleep 5 && curl -sf http://127.0.0.1:8620/healthz   # data survived recreation
docker compose down
```

## Reverse-proxy configs valid (DEPLOY-01)

```bash
# nginx (needs a throwaway self-signed cert at the paths the example references)
docker run --rm -v "$PWD/deploy/nginx.conf.example":/etc/nginx/nginx.conf:ro nginx:1-alpine nginx -t
# caddy
docker run --rm -v "$PWD/deploy/Caddyfile.example":/etc/caddy/Caddyfile:ro caddy:2 caddy validate --config /etc/caddy/Caddyfile
```

## End-to-end proxy gate incl. WR-02 token-strip (DEPLOY-01, closes Phase-5 WR-02)

```bash
bash scripts/verify-container.sh
# Expected exit 0. For BOTH nginx-test and caddy-test it asserts:
#   - HTTPS /healthz → 200 (curl -k + Host header)
#   - WS upgrade → 101 over TLS using a REAL session token (script registers+logs in first;
#     an empty sessions table rejects placeholder tokens with 401 pre-upgrade)
#   - the session token query param is ABSENT from each proxy's own access log (WR-02)
```

## Full passkey ceremony behind a proxy (manual, browser-driven)

Not scriptable with curl/websocat (needs a browser + authenticator). Per this project's
Playwright-UAT convention: against the proxied HTTPS URL, register a passkey, PRF-unlock,
trigger a sync, and confirm the `/api/sync/ws` reconnect path works through **both** nginx
and Caddy.

---

**Sign-off:** Rust + fail-loud runtime criteria PASSED autonomously. The above container/proxy
E2E is the pre-production checklist for a Docker host — hand to Bartek / run on deploy target.
