# AASA-DEPLOY.md -- Plan 43-08, Task 1

**TEST-HARNESS-ONLY infrastructure.** This document is NOT a general self-hosting requirement.
A real self-hoster running Passkey Vault has no reason to ever serve an
`apple-app-site-association` file -- Passkey Vault's own passkey-provider role on iOS needs only
the `com.apple.developer.authentication-services.autofill-credential-provider` entitlement
(43-RESEARCH.md Finding 1), never Associated Domains. This file exists ONLY so
`ios/PasskeyVaultHarness` (a throwaway test app, never distributed) can genuinely prove ROADMAP
SC2 -- a native, third-party-shaped app routing a passkey request into Passkey Vault's real
AutoFill extension -- against a domain Bartek actually controls (`vault.blonie.cloud`), because
Associated Domains structurally requires a real HTTPS domain (`localhost` cannot serve it).

`crates/pv-server` is NEVER touched by any of this (CLAUDE.md / Phase 39 D-01's standing gate:
`git diff --stat -- crates/pv-server` is empty before, during, and after this plan). AASA is
served entirely by the reverse proxy sitting in front of `vault.blonie.cloud`, intercepting
exactly one path before it ever reaches `pv-server`.

## 1. The AASA JSON body

Team ID `4S7F2M7YLW` is this project's REAL `DEVELOPMENT_TEAM`, read directly from
`ios/PasskeyVault/PasskeyVault.xcodeproj/project.pbxproj` (every `XCBuildConfiguration` in this
project already uses it) -- never a placeholder.

```json
{"webcredentials":{"apps":["4S7F2M7YLW.cloud.blonie.PasskeyVaultHarness"]}}
```

`cloud.blonie.PasskeyVaultHarness` is the harness app's own, genuinely distinct bundle id (never
`cloud.blonie.PasskeyVault`, the shipping app's bundle id -- 43-08-PLAN.md's own prohibition).

## 2. Reference nginx snippet (style/verification reference, `scripts/verify-aasa-proxy-snippet.sh`'s own fixture)

A full, standalone `nginx.conf` (validates on its own, matching `deploy/nginx.conf.example`'s own
"full top-level nginx.conf, not a bare `server {}` fragment" convention) -- the `location =` block
is the load-bearing part; everything else is the minimum wrapper nginx needs to boot.

```nginx
events {
    worker_connections 16;
}

http {
    server {
        listen 80;

        # Exact-match location -- nginx always prefers an exact `location =` match over any
        # prefix location, REGARDLESS of file order, so this never needs to be reordered against
        # a general `location /` proxy_pass block elsewhere in a real deployment.
        #
        # `default_type application/json` + `return 200 '<JSON>'` is the load-bearing pair here:
        # this plan's own revision confirmed EMPIRICALLY, via a throwaway probe run and cleaned
        # up during planning, that serving this SAME file through pv-server's existing static
        # `ServeDir` fallback returns `Content-Type: application/octet-stream` for this
        # extensionless path -- the exact "looks right, silently wrong" failure shape Phase 29's
        # `rewrite_nested_static_route` precedent already cost this project once. This snippet
        # sets `Content-Type: application/json` explicitly, verified below, never left to
        # extension-based MIME guessing.
        location = /.well-known/apple-app-site-association {
            default_type application/json;
            return 200 '{"webcredentials":{"apps":["4S7F2M7YLW.cloud.blonie.PasskeyVaultHarness"]}}';
        }
    }
}
```

`scripts/verify-aasa-proxy-snippet.sh` writes this EXACT content to a scratch file, boots a
throwaway `nginx:1-alpine` container with it, and asserts BOTH `HTTP 200` AND
`Content-Type: application/json` from a real `curl -i` against it -- never status alone.

## 3. The ACTUAL mechanism fronting `vault.blonie.cloud` today (investigated, not assumed)

Investigated live via `ssh oracle` (read-only: `docker ps`, `docker inspect`, and a `GET
/api/v1/applications/aezodqfe71wxsyl888yk8kqs` against Coolify's own API), 2026-08-22:

- **Proxy: Traefik (`traefik:v3.6`, container `coolify-proxy`), Coolify's own default -- confirmed,
  not assumed.** Coolify's server record (`server.proxy.type`) reads `"TRAEFIK"` explicitly.
- **Routing mechanism: Docker labels, read by Traefik's own Docker provider**
  (`--providers.docker=true`, `--providers.docker.exposedbydefault=false` -- confirmed from the
  live `coolify-proxy` container's own boot command). `passkey-vault`'s container
  (`aezodqfe71wxsyl888yk8kqs-*`) carries `traefik.http.routers.https-0-aezodqfe71wxsyl888yk8kqs.rule
  = Host(`vault.blonie.cloud`) && PathPrefix(`/`)`, routing ALL paths to `pv-server:8620` -- this is
  the router this plan must route AROUND for exactly one path, never modify.
- **`custom_nginx_configuration` field: `null`.** Confirmed via Coolify's own API response for this
  application -- this Coolify app is `build_pack: "dockerfile"` (not one of the template types
  Coolify's nginx-config panel targets), so this field is NOT the right mechanism here (43-08-PLAN.md's
  own prohibition against assuming a specific proxy/panel without confirming it -- confirmed absent,
  not assumed present).
- **A SECOND mechanism also confirmed present and unused: Traefik's own file provider.** The live
  `coolify-proxy` boot command includes `--providers.file.directory=/traefik/dynamic/` and
  `--providers.file.watch=true`, backed by the host path `/data/coolify/proxy/` (mounted into the
  container at `/traefik`) -- i.e. `/data/coolify/proxy/dynamic/*.yml` on the Oracle host is a
  live-reloaded, Coolify-native place to declare ADDITIONAL Traefik routers/services with no
  dependency on any single application's own Coolify resource. Documented here as a viable
  ALTERNATIVE (Section 5) to the Docker-label sidecar this plan recommends as primary, per
  43-08-PLAN.md's own instruction to name the actual mechanism(s) found, not just one.

**Conclusion: no per-application "custom nginx configuration" panel applies to this Dockerfile-based
app. The real mechanism is Traefik's own Docker-label-driven routing** (the SAME mechanism the
`passkey-vault` app's own router already uses) -- **applied to a NEW, separate, minimal sidecar
container**, never to the `passkey-vault` application's own Coolify resource. This keeps AASA's
lifecycle fully decoupled from `passkey-vault`'s own deploys/redeploys/config-hash changes, and
means Task 2 touches ZERO existing Coolify-managed resource.

## 4. Real-deployment steps (Task 2's own numbered actions)

1. On the Oracle host (`ssh oracle`), write the nginx config from Section 2 verbatim to
   `/data/coolify/proxy/pv-aasa-harness.conf` (a plain file next to Coolify's own proxy data
   directory -- NOT inside `/data/coolify/proxy/dynamic/`, which is Traefik's OWN YAML-only
   dynamic-config directory; mixing a non-YAML file into it would make Traefik's file provider try
   to parse it and fail. This nginx.conf is the SIDECAR CONTAINER's own config file, mounted into
   that container only, never read by Traefik itself).

2. Start the sidecar container on the SAME `coolify` Docker network the proxy and every other
   Coolify-managed app already use, carrying its own Traefik Docker-provider labels (mirroring
   `passkey-vault`'s own router style exactly, confirmed live in Section 3):

   ```bash
   docker run -d --name pv-aasa-harness \
     --network coolify \
     --restart unless-stopped \
     -v /data/coolify/proxy/pv-aasa-harness.conf:/etc/nginx/nginx.conf:ro \
     --label traefik.enable=true \
     --label 'traefik.http.routers.pv-aasa-harness.rule=Host(`vault.blonie.cloud`) && Path(`/.well-known/apple-app-site-association`)' \
     --label 'traefik.http.routers.pv-aasa-harness.entrypoints=https' \
     --label 'traefik.http.routers.pv-aasa-harness.tls=true' \
     --label 'traefik.http.routers.pv-aasa-harness.tls.certresolver=letsencrypt' \
     --label 'traefik.http.routers.pv-aasa-harness.priority=1000' \
     --label 'traefik.http.services.pv-aasa-harness.loadbalancer.server.port=80' \
     nginx:1-alpine
   ```

   `priority=1000` guarantees this router wins over `passkey-vault`'s own `PathPrefix(`/`)` router
   for this ONE exact path, regardless of Traefik's own rule-length-based default priority
   computation (explicit priority always wins over the computed default). `tls.certresolver=letsencrypt`
   matches `passkey-vault`'s own router exactly -- Traefik's ACME store is shared per-instance
   (`/traefik/acme.json`), so this reuses the SAME already-issued `vault.blonie.cloud` certificate
   rather than requesting a redundant one; Let's Encrypt's own rate limiting is a non-issue here
   (no new cert requested, confirmed by checking Traefik's own logs after this step -- see step 3).

3. Verify Traefik picked up the new container (it auto-discovers via its Docker provider, no
   reload needed): `docker logs coolify-proxy --tail 50 | grep -i pv-aasa-harness` should show the
   router/service registered with no error.

4. Confirm success from OUTSIDE the Oracle host (a real, independent client, never `curl`
   against `localhost` on the box itself):

   ```bash
   curl -i https://vault.blonie.cloud/.well-known/apple-app-site-association
   ```

   Expect: `HTTP/2 200`, `content-type: application/json`, body exactly
   `{"webcredentials":{"apps":["4S7F2M7YLW.cloud.blonie.PasskeyVaultHarness"]}}`. ALSO confirm the
   REST of the site is untouched: `curl -i https://vault.blonie.cloud/healthz` still reaches
   `pv-server` (proves this new router is scoped to exactly one path, not a blanket override).

5. Rollback (fully reversible, touches nothing Coolify-managed): `docker rm -f pv-aasa-harness`.

## 5. Alternative mechanism (Traefik file provider, Coolify-native, not used as primary)

Instead of Docker labels on the sidecar container, the SAME sidecar's routing could instead be
declared via a YAML file dropped into Traefik's own live-reloaded dynamic-config directory,
`/data/coolify/proxy/dynamic/pv-aasa-harness.yml` (Section 3's second confirmed mechanism):

```yaml
http:
  routers:
    pv-aasa-harness:
      rule: "Host(`vault.blonie.cloud`) && Path(`/.well-known/apple-app-site-association`)"
      entryPoints: ["https"]
      service: pv-aasa-harness
      priority: 1000
      tls:
        certResolver: letsencrypt
  services:
    pv-aasa-harness:
      loadBalancer:
        servers:
          - url: "http://pv-aasa-harness:80"
```

This still requires the SAME sidecar container (Section 4, step 2) to exist and be reachable on
the `coolify` network by name -- the file provider only replaces HOW the router/service are
declared (a Traefik-native YAML file instead of Docker labels on the container itself), not
whether a sidecar container is needed at all. Not used as this plan's primary recommendation
because the Docker-label form mirrors `passkey-vault`'s own existing router style byte-for-byte
(Section 3), needs no extra file outside the container's own definition, and is what Task 2's own
numbered steps (Section 4) use.

## 6. What Task 2 is NOT

Task 2 is never applied unattended by this plan's own automation -- it is an explicit, described
action for Bartek (or Claude acting live, under his direct real-time instruction) precisely
because it touches live production infrastructure fronting his real self-hosted vault
(43-08-PLAN.md's own prohibition). Everything above this section is fully verified LOCALLY,
against a throwaway, repo-local container (`scripts/verify-aasa-proxy-snippet.sh`) -- Section 4 is
the ONE step this document documents but does not execute.
