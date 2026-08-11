//! heap_probe — TEST-ONLY (`#[cfg(test)]`) observation of what `pv-ffi`
//! actually hands back to the allocator.
//!
//! Exists for exactly one regression: CR-01 (Faza 35 code review) — an owned
//! `Vec<u8>` master password released to the allocator with its bytes intact
//! on `FfiWrappingKey::from_password`'s `?` early-return path, a path an
//! untrusted server can trigger at will. An assertion of the form "the source
//! now says `Zeroizing`" would be a check that cannot fail (this repo has
//! paid for that class of defect repeatedly — see
//! `scripts/audit-ffi-opaque-handles.sh`'s header). This module asserts on
//! the freed bytes themselves instead.
//!
//! Mechanism: a `GlobalAlloc` wrapper delegating to `System` that, while
//! ARMED, scans each block being freed for a unique sentinel pattern and
//! records whether the pattern was still present at free time. It never
//! allocates inside `dealloc` (that would recurse into itself) and is inert
//! outside a `Probe` window.
//!
//! Compiled ONLY into `cargo test`'s binary: the `mod heap_probe;`
//! declaration in `lib.rs` carries `#[cfg(test)]`, so no allocator override
//! ever reaches the `staticlib` that `scripts/build-ios.sh` links into the
//! XCFramework.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

/// A 42-byte pattern that appears nowhere else in this crate or its tests,
/// so a hit can only have come from the buffer under test.
pub(crate) const SENTINEL: &[u8] = b"pv-ffi-CR01-heap-probe-sentinel-password!!";

/// Blocks larger than this are not scanned. The only allocation under test is
/// a ~42-byte `Vec<u8>`; scanning without a cap would drag every concurrently
/// running test's 8 MiB Argon2 buffer through a byte-window search. This
/// cannot make the probe silently blind to what it asserts on: the test's own
/// control allocates and frees a buffer of exactly the same shape and
/// requires the probe to see it.
const MAX_SCANNED_BLOCK: usize = 4096;

static ARMED: AtomicBool = AtomicBool::new(false);
static SEEN: AtomicBool = AtomicBool::new(false);

/// Serializes probe windows so two `#[test]`s can never arm concurrently
/// (Rust's test harness runs tests on parallel threads by default).
static PROBE_LOCK: Mutex<()> = Mutex::new(());

struct SentinelScanningAlloc;

unsafe impl GlobalAlloc for SentinelScanningAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        if ARMED.load(Ordering::Relaxed)
            && layout.size() >= SENTINEL.len()
            && layout.size() <= MAX_SCANNED_BLOCK
        {
            // The block is still mapped and readable until the `System`
            // delegation below. Nothing in here allocates.
            let block = std::slice::from_raw_parts(ptr as *const u8, layout.size());
            if block.windows(SENTINEL.len()).any(|w| w == SENTINEL) {
                SEEN.store(true, Ordering::Relaxed);
            }
        }
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOC: SentinelScanningAlloc = SentinelScanningAlloc;

/// An open observation window. Dropping it always disarms, so a panicking
/// test cannot leave the scan permanently active for the rest of the suite.
pub(crate) struct Probe(#[allow(dead_code)] MutexGuard<'static, ()>);

impl Probe {
    pub(crate) fn arm() -> Self {
        // A poisoned lock only means some other test panicked; the probe
        // state itself is two atomics and cannot be left inconsistent.
        let guard = PROBE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        SEEN.store(false, Ordering::SeqCst);
        ARMED.store(true, Ordering::SeqCst);
        Probe(guard)
    }

    /// Closes the window and reports whether ANY block freed inside it still
    /// contained `SENTINEL`.
    pub(crate) fn sentinel_reached_allocator(&self) -> bool {
        ARMED.store(false, Ordering::SeqCst);
        SEEN.load(Ordering::SeqCst)
    }
}

impl Drop for Probe {
    fn drop(&mut self) {
        ARMED.store(false, Ordering::SeqCst);
    }
}
