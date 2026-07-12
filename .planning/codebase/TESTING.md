# Testing Patterns

**Analysis Date:** 2026-07-12

## Test Framework

**Runner:**
- Rust built-in test framework (no external test runner)
- Cargo test harness (`cargo test`)
- Runs on stable Rust (2021 edition)
- Targets: standard library + default target

**Assertion Library:**
- Standard Rust macros: `assert!`, `assert_eq!`, `assert_ne!`

**Run Commands:**

```bash
# Run all tests in workspace
cargo test

# Run tests for specific crate
cargo test -p pv-core
cargo test -p pv-server

# Run tests with output displayed
cargo test -- --nocapture

# Run specific test
cargo test wrap_unwrap_roundtrip
```

## Test File Organization

**Location:**
- Tests are **co-located with code** in the same file
- Test modules at the bottom of source files

**Naming:**
- Test module: always `mod tests`
- Test functions: start with test name (no prefix required, `#[test]` attribute marks them)
- Test names describe what's being tested (e.g., `wrap_unwrap_roundtrip`, `wrong_key_fails`)

**Structure:**

```
crates/pv-core/src/keys.rs
├── imports
├── constants (KEY_LEN, NONCE_LEN, INFO_*)
├── public functions
├── internal functions
└── #[cfg(test)]
    mod tests {
        use super::*;
        
        #[test]
        fn test_name() { ... }
    }
```

## Test Structure

**Suite Organization:**

From `crates/pv-core/src/keys.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrap_unwrap_roundtrip() {
        let uk = UserKey::generate();
        let wk = hkdf_expand_key(b"some ikm", INFO_PW_UNLOCK);
        let blob = wrap_user_key(&wk, &uk).unwrap();
        let uk2 = unwrap_user_key(&wk, &blob).unwrap();
        assert_eq!(uk.expose(), uk2.expose());
    }

    #[test]
    fn wrong_key_fails() {
        let uk = UserKey::generate();
        let wk = hkdf_expand_key(b"some ikm", INFO_PW_UNLOCK);
        let blob = wrap_user_key(&wk, &uk).unwrap();
        let bad = hkdf_expand_key(b"other ikm", INFO_PW_UNLOCK);
        assert!(unwrap_user_key(&bad, &blob).is_err());
    }
}
```

**Patterns:**

- **Setup:** Create test data using public constructors (e.g., `UserKey::generate()`)
- **Action:** Call the function/method being tested
- **Assertion:** Use `assert_*` macros to verify results
- **No teardown:** Rust automatically cleans up when test ends

**Key characteristics:**
- Each test is independent and self-contained
- No shared state between tests
- Tests can be run in parallel
- Simple, readable structure with arrange-act-assert flow

## Mocking

**Framework:** 
- None used in codebase currently
- Cryptographic code uses **real randomness** and **real cryptography** — no mocks

**Patterns:**
- Cryptographic functions tested with real crypto (not mocked)
- Example: `UserKey::generate()` uses real `OsRng` in tests

From `crates/pv-core/src/keys.rs`:
```rust
#[test]
fn wrap_unwrap_roundtrip() {
    let uk = UserKey::generate();  // Real randomness
    let wk = hkdf_expand_key(b"some ikm", INFO_PW_UNLOCK);  // Real KDF
    let blob = wrap_user_key(&wk, &uk).unwrap();  // Real encryption
    let uk2 = unwrap_user_key(&wk, &blob).unwrap();  // Real decryption
    assert_eq!(uk.expose(), uk2.expose());
}
```

**What to Mock:**
- Generally avoided in crypto-heavy code (pv-core)
- Server integration (axum handlers, database) — no tests written yet

**What NOT to Mock:**
- Cryptographic primitives (HKDF, AEAD, KDF)
- Randomness (use real `OsRng`)
- Key generation and manipulation

## Fixtures and Factories

**Test Data:**
- No factory pattern used
- Test data created inline using public constructors

From `crates/pv-core/src/items.rs`:
```rust
#[test]
fn item_roundtrip() {
    let uk = UserKey::generate();
    let payload = br#"{"type":"login","username":"bartek","password":"s3cret"}"#;
    let item = encrypt_item(&uk, payload).unwrap();
    assert_eq!(decrypt_item(&uk, &item).unwrap(), payload);
}
```

From `crates/pv-core/src/prf.rs`:
```rust
#[test]
fn prf_unlock_roundtrip() {
    let uk = UserKey::generate();
    let prf_output = [7u8; PRF_OUTPUT_LEN];  // Simple test data
    let wk = wrapping_key_from_prf(&prf_output).unwrap();
    // ...
}
```

**Location:**
- No shared fixtures directory
- Test data defined inline within test functions
- Constants defined at module level for reuse (e.g., `PRF_OUTPUT_LEN`)

## Coverage

**Requirements:** 
- No explicit coverage requirements or target defined
- No coverage configuration (no `cargo tarpaulin` or `cargo llvm-cov` setup)
- Coverage responsibility: developer awareness

**Current Coverage:**
- `pv-core`: Unit tests for crypto primitives (keys, KDF, items, PRF)
- `pv-server`: No tests yet (routes and handlers marked with TODO)

**View Coverage:**
- Not configured in this repo
- Could be added with `cargo tarpaulin` or `cargo llvm-cov` in the future

## Test Types

**Unit Tests:**
- **Scope:** Individual functions and crypto operations
- **Approach:** Direct function calls with test data
- **Location:** `#[cfg(test)]` modules in `crates/pv-core/src/`
- **Count:** 6 tests across 3 modules (keys, items, prf)

**Integration Tests:**
- **Status:** Not implemented yet
- **Future:** Would test full workflows (account creation, login, item encryption/decryption)
- **Location:** Would go in `crates/pv-core/tests/` or `crates/pv-server/tests/` (integration test directory)

**E2E Tests:**
- **Framework:** Not used
- **Future:** Could use tools like `http` client + test database for end-to-end server testing

**Example Test Matrix in pv-core:**

| Module | Test Name | Type | Purpose |
|--------|-----------|------|---------|
| `keys.rs` | `wrap_unwrap_roundtrip` | Unit | Verify wrap/unwrap cycle works correctly |
| `keys.rs` | `wrong_key_fails` | Unit | Verify decryption fails with wrong key |
| `items.rs` | `item_roundtrip` | Unit | Verify encrypt/decrypt cycle for items |
| `items.rs` | `other_user_key_cannot_decrypt` | Unit | Verify items can't be decrypted with wrong key |
| `prf.rs` | `prf_unlock_roundtrip` | Unit | Verify PRF-based key derivation and unwrap |
| `prf.rs` | `short_prf_output_rejected` | Unit | Verify validation of PRF output length |

## Common Patterns

**Roundtrip Testing:**
- Most common pattern: test that data survives a cycle (encode → decode, encrypt → decrypt, wrap → unwrap)

From `crates/pv-core/src/items.rs`:
```rust
#[test]
fn item_roundtrip() {
    let uk = UserKey::generate();
    let payload = br#"{"type":"login","username":"bartek","password":"s3cret"}"#;
    let item = encrypt_item(&uk, payload).unwrap();
    assert_eq!(decrypt_item(&uk, &item).unwrap(), payload);
}
```

**Error Testing:**
- Verify that invalid inputs produce errors, not panics

From `crates/pv-core/src/prf.rs`:
```rust
#[test]
fn short_prf_output_rejected() {
    assert!(wrapping_key_from_prf(&[0u8; 16]).is_err());
}
```

From `crates/pv-core/src/keys.rs`:
```rust
#[test]
fn wrong_key_fails() {
    let uk = UserKey::generate();
    let wk = hkdf_expand_key(b"some ikm", INFO_PW_UNLOCK);
    let blob = wrap_user_key(&wk, &uk).unwrap();
    let bad = hkdf_expand_key(b"other ikm", INFO_PW_UNLOCK);
    assert!(unwrap_user_key(&bad, &blob).is_err());
}
```

**Async Testing:**
- Not used in current codebase (pv-core is sync)
- Server handlers are async but not yet tested

**No Framework Overhead:**
- Tests use only Rust stdlib (no test libraries/frameworks)
- Minimal setup/teardown (usually none)
- Fast execution (all crypto is real but lightweight)

## Testing Best Practices Observed

1. **Test names describe behavior**, not implementation
   - ✓ `wrap_unwrap_roundtrip` — describes the cycle
   - ✓ `wrong_key_fails` — describes the expected behavior

2. **Tests are deterministic**
   - Each test runs the same way every time
   - Uses real randomness (okay because function is deterministic about failure modes)

3. **Minimal test scope**
   - Each test focuses on one behavior
   - Arrange-act-assert flow is clear

4. **Tests verify both success and failure paths**
   - Success: `wrap_unwrap_roundtrip`
   - Failure: `wrong_key_fails`, `short_prf_output_rejected`

5. **No test inter-dependencies**
   - Tests can run in any order
   - Tests can run in parallel

## Areas Needing Test Coverage

**Not Yet Tested:**
- `crates/pv-server/src/main.rs` — initialization, config loading, graceful shutdown
- `crates/pv-server/src/config.rs` — environment variable parsing
- `crates/pv-server/src/routes/auth.rs` — HTTP handlers (currently stubs with TODOs)
- `crates/pv-server/src/routes/mod.rs` — router setup
- Database interactions (not implemented yet)

**Future Testing Strategy:**
- Add integration tests in `crates/pv-server/tests/` for HTTP routes
- Add database tests with test fixtures
- Add async test patterns when server endpoints are implemented

---

*Testing analysis: 2026-07-12*
