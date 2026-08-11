//! `uniffi-bindgen-swift` — required companion binary for Swift bindgen.
//!
//! `uniffi-bindgen-swift` is NOT published standalone on crates.io (confirmed
//! via `cargo search uniffi-bindgen-swift` returning zero results this
//! session) — it ships only as a workspace-internal binary inside the
//! mozilla/uniffi-rs repo itself. Every *consuming* crate must provide this
//! thin wrapper itself, auto-discovered by Cargo from `src/bin/<name>.rs`
//! (no `[[bin]]` table needed in Cargo.toml). Source verbatim from
//! mozilla/uniffi-rs docs/manual/src/swift/uniffi-bindgen-swift.md's own
//! "Rust Binary for uniffi-bindgen-swift" example.
//!
//! Invoked by `scripts/build-ios.sh` via:
//!   cargo run -p pv-ffi --bin uniffi-bindgen-swift -- <lib>.a <out-dir> \
//!     --xcframework --modulemap --modulemap-filename module.modulemap

fn main() {
    uniffi::uniffi_bindgen_swift();
}
