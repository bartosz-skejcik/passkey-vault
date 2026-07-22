# syntax=docker/dockerfile:1
#
# Three-stage build for a single self-contained pv-server image:
#   1. rust-builder — compiles the REAL crates/pv-core + crates/pv-wasm source
#      via scripts/build-wasm.sh, then the REAL crates/pv-server binary.
#   2. web-builder   — Node-only static export of web/ (never re-triggers
#      web/package.json's prebuild/predev hooks, which need the Rust
#      toolchain this stage deliberately doesn't have).
#   3. runtime       — debian:bookworm-slim, ships only the pv-server binary
#      + the static Next.js export. No cargo/node/npm/rustc survive.
#
# Produces /app/pv-server + /app/static, servable on one port
# (PV_ADDR=0.0.0.0:8620 by default) with SQLite persisted under /data.

########################################
# Stage 1: rust-builder
########################################
FROM rust:1-slim AS rust-builder
WORKDIR /app

# 1. Copy toolchain pin + workspace manifests first — maximizes cache reuse
#    for dependency-only changes. rustup auto-detects rust-toolchain.toml in
#    the current directory, so no explicit `rustup target add` is needed
#    beyond what the toolchain file already declares
#    (targets = ["wasm32-unknown-unknown"]).
COPY rust-toolchain.toml Cargo.toml Cargo.lock ./

# 2. Copy the REAL crates/pv-core, crates/pv-provider and crates/pv-wasm
#    source trees in FULL. These are the crates scripts/build-wasm.sh
#    actually compiles and binds via wasm-bindgen (pv-wasm's provider
#    bindings link pv-provider since v0.2) — a stub lib.rs for any of them
#    would let `cargo build` "succeed" against zero real code and
#    wasm-bindgen would then silently emit glue with no crypto exports at
#    all. Real bodies from the start is the only way to guarantee the
#    shipped WASM is functional.
COPY crates/pv-core/ crates/pv-core/
COPY crates/pv-provider/ crates/pv-provider/
COPY crates/pv-wasm/ crates/pv-wasm/

# 3. crates/pv-server is a virtual-workspace member too (root Cargo.toml
#    lists every member). Cargo refuses to resolve ANY command — including
#    build-wasm.sh's own `cargo build -p pv-wasm` — unless every workspace
#    member has a manifest present on disk ("failed to load manifest for
#    workspace member crates/pv-server" otherwise). pv-server is never
#    actually built in this layer, so a manifest-only stub is safe here
#    (unlike pv-core/pv-wasm above, which build-wasm.sh really compiles).
#    pv-server declares BOTH a lib.rs and a main.rs target — the stub must
#    satisfy both so the manifest resolves.
COPY crates/pv-server/Cargo.toml crates/pv-server/Cargo.toml
RUN mkdir -p crates/pv-server/src \
    && touch crates/pv-server/src/lib.rs \
    && echo 'fn main() {}' > crates/pv-server/src/main.rs

# 4. Copy the WASM build script + web/package.json. The script's own
#    `mkdir -p web/src/lib/crypto/wasm web/public/wasm` calls need web/ to
#    exist as a sibling directory — do NOT copy the rest of web/ yet, to
#    preserve this layer's cache-split from crates/pv-server's own layer.
COPY scripts/build-wasm.sh scripts/build-wasm.sh
COPY web/package.json web/package.json

# 5. wasm-bindgen-cli is installed from source by build-wasm.sh
#    (`cargo install wasm-bindgen-cli --version <pinned> --locked`) —
#    pkg-config + a C toolchain are required for some of its transitive
#    dependencies to build on a slim base image. libssl-dev is required to
#    compile openssl-sys, pulled in (non-optionally) by webauthn-rs 0.5's
#    attestation-CA path (openssl v0.10, dynamically linked) — without it
#    `cargo build -p pv-server` fails with "could not find OpenSSL".
RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config build-essential libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# 6. Run build-wasm.sh unmodified. Resolves because all three workspace
#    members now have manifests on disk (pv-core/pv-wasm real, pv-server
#    stub), and it produces a real pv_wasm_bg.wasm with real crypto
#    exports, since the two crates it actually compiles (pv-core, pv-wasm)
#    are real. This is the layer that stays CACHED on a pv-server-only
#    source change, and is correctly invalidated by a pv-core/pv-wasm
#    source change.
RUN bash scripts/build-wasm.sh

# 7. THEN copy the real crates/pv-server tree (overwriting its stub src/)
#    and build the release binary — the only step invalidated by a
#    pv-server-only source edit; steps 1-6 stay cached.
COPY crates/pv-server/ crates/pv-server/
RUN cargo build -p pv-server --release

########################################
# Stage 2: web-builder
########################################
FROM node:20-slim AS web-builder
WORKDIR /app/web

# D-13 (plan 11-07): web/package.json depends on pv-ui via a `file:../
# packages/pv-ui` path (deliberately NOT an npm/yarn workspace — web/ and
# extension/ each keep their own self-contained package-lock.json/build
# pipeline, matching the existing per-project Docker cache-split this
# stage relies on). `npm ci` resolves that local dependency by copying the
# target directory into node_modules, so packages/pv-ui must exist on disk
# BEFORE the install step below — copied to /app/packages/pv-ui (one level
# up from this stage's WORKDIR), matching the "../packages/pv-ui"
# relative path in web/package.json exactly.
COPY packages/pv-ui/ /app/packages/pv-ui/
RUN cd /app/packages/pv-ui && npm ci

# Install deps first for cache reuse. --ignore-scripts is load-bearing:
# web/package.json's prebuild/predev hooks invoke scripts/build-wasm.sh,
# which needs the Rust toolchain this stage doesn't have — a bare
# `npm ci`/`npm install` would fail outright.
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts

# Copy the rest of web/, then overlay the WASM artifacts build-wasm.sh
# already produced in rust-builder (there is no placeholder to overwrite,
# since --ignore-scripts skipped prebuild entirely).
COPY web/ ./
COPY --from=rust-builder /app/web/src/lib/crypto/wasm ./src/lib/crypto/wasm
COPY --from=rust-builder /app/web/public/wasm ./public/wasm

# next.config.ts sets `output: "export"` — produces a static web/out/ tree.
# `npx next build` directly, never `npm run build`, which re-triggers the
# prebuild lifecycle hook skipped above.
RUN npx next build

########################################
# Stage 3: runtime
########################################
FROM debian:bookworm-slim
WORKDIR /app

# debian:bookworm-slim ships neither curl nor wget by default — wget is
# needed for the HEALTHCHECK's HTTP probe against /healthz. libssl3 is the
# runtime shared library the pv-server binary dynamically links (openssl-sys
# via webauthn-rs); bookworm-slim omits it, so the binary would fail at
# startup with "libssl.so.3: cannot open shared object file". ca-certificates
# lets OpenSSL verify trust roots (attestation / any outbound TLS).
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget libssl3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=rust-builder /app/target/release/pv-server /app/pv-server
COPY --from=web-builder /app/web/out /app/static

# Matches the COPY target above exactly — main.rs reads PV_STATIC_DIR via
# std::env::var(...).ok() and threads it into routes::router()'s static_dir
# parameter.
ENV PV_STATIC_DIR=/app/static

# config.rs's own bare default is 127.0.0.1:8620, which only accepts
# connections from inside the container's own network namespace — a bare
# `docker run -p 8620:8620` with no other flags would otherwise be
# completely unreachable from the host despite the port mapping looking
# correct. Overridable via `-e PV_ADDR=...` same as any other env var, e.g.
# to bind a different port.
ENV PV_ADDR=0.0.0.0:8620

# Bakes the persisted-volume path in as the image's own default — a bare
# `docker run -v pv_data:/data` with no other flags must write into /data,
# not config.rs's relative-path dev default. Overridable via
# `-e PV_DB_URL=...` same as any other env var.
ENV PV_DB_URL=sqlite:///data/pv.db

# Declares /data as the image's persisted mount point so even an operator
# who forgets -v/--mount entirely still gets an anonymous volume rather
# than silently-lost container-local writes.
VOLUME /data

EXPOSE 8620

# Hardcodes port 8620 — a non-default PV_ADDR port requires updating this
# line too.
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget --spider -q http://127.0.0.1:8620/healthz || exit 1

ENTRYPOINT ["/app/pv-server"]
