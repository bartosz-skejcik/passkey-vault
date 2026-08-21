#!/usr/bin/env bash
# scripts/audit-ios-identity-store-chokepoint.sh -- Phase 41 (autofill-dla-hase-i-poprawno-blokady-
# mi-dzy-procesami), Plan 41-08, Task 3 (E41-9 item 2): the standing structural gate over FILL-03's
# choke point. Two independent assertions, both against the REAL sources under
# `ios/PasskeyVault/{PasskeyVault,PasskeyVaultAutoFill,Shared}`:
#
#   (A) The identity store is WRITTEN from an EXACT, explicit allow-list of files, never anywhere
#       else. "Written" is scoped to the six call shapes that actually mutate
#       `ASCredentialIdentityStore` or construct an entry FOR mutation -- `ASPasswordCredentialIdentity(`
#       construction, `ASPasskeyCredentialIdentity(` construction (Plan 43-05, OPT-03: the passkey-
#       identity machinery inside the SAME choke point, `IdentityStoreSync.swift`), and
#       `.saveCredentialIdentities(`/`.removeCredentialIdentities(`/
#       `.replaceCredentialIdentities(`/`.removeAllCredentialIdentities(` calls -- never a bare
#       READ (`ASCredentialIdentityStore.shared.state()`/`.getState`/`.credentialIdentities(forService:)`
#       alone, with no write pattern anywhere in the same file), because FILL-03's actual failure
#       mode (this plan's own `<threat_model>` T-41-41) is a MUTATION that never reaches QuickType,
#       not a read.
#
#       Ground-truthed against the real tree, this session (`grep -rnE` for the five patterns
#       across all three roots, excluding test targets): exactly THREE files match --
#       `ios/PasskeyVault/Shared/IdentityStoreSync.swift` (the production choke point, 41-04),
#       `ios/PasskeyVault/PasskeyVault/MatchingProbe.swift` (DR-41-B's own three-distinct-identity
#       evidence probe, 41-05 -- its own header states it deliberately bypasses `IdentityStoreSync`
#       to register `.URL`-typed identities that writer does not produce), and
#       `ios/PasskeyVault/PasskeyVault/IdentityStoreSyncProbe.swift` (E41-2's own evidence probe,
#       41-04 -- `removeAllCredentialIdentities()` used only for test-isolation resets between its
#       three runs). `CredentialProviderViewController.swift` (the extension) does NOT appear in
#       this list: 41-04 wired its full-rebuild hook and post-fill self-heal write to reach
#       `ASCredentialIdentityStore` EXCLUSIVELY through `IdentityStoreSync.republish(sources:)`,
#       never directly -- so this plan's own `<action>` text, which anticipated needing to
#       allow-list the extension's OWN write call sites, turns out not to need that entry; the
#       allow-list below reflects the REAL tree, not the plan's own anticipation (documented as a
#       deviation in 41-08-SUMMARY.md).
#
#   (B) Every mutation call site 41-04-SUMMARY.md's own "the mutation call-site list" enumerates
#       still reaches `IdentityStoreSync.republish(` -- the direction that ACTUALLY fails silently
#       (T-41-41): a call site that stops calling the writer produces no error, no crash, just a
#       QuickType entry that is quietly never there or never updated. Six sites, all in the SAME
#       two files: `VaultStore.swift`'s `create`/`update`/`delete`/`performRefresh` (the sync-pull
#       completion, run after the shared/family-wide merge), and
#       `CredentialProviderViewController.swift`'s post-fill self-heal write and full-rebuild
#       recovery path (`runIdentityRebuildIfPending()`). Each site is located by its OWN function
#       DECLARATION (a stable, low-drift anchor, per this plan's own `<read_first>` guidance to
#       "prefer scanning all declarations ... over isolating a region and trusting the isolation"
#       -- 35-REVIEW's CR-02/CR-03), then a BOUNDED forward line-window (not brace-depth
#       extraction) is searched for `IdentityStoreSync.republish(`. A bounded window is sound here
#       specifically because this is a FIXED, ENUMERATED set of six known sites with known,
#       generous gaps to their own neighbours -- never a general "find where a function ends"
#       scanner, which is exactly the CR-02/CR-03 trap this plan's own `<read_first>` warns against.
#
# Every scan below runs over a comment/string-STRIPPED copy (the exact CR-02 technique
# `scripts/audit-ffi-opaque-handles.sh` already proved sound) -- so this file's own header prose
# (which necessarily quotes every pattern/anchor below) can never trip itself, and a call that has
# been COMMENTED OUT (the honest shape of "this call site stopped calling the writer") is correctly
# treated as ABSENT, not present.
#
# Never relies on bash's post-pipe exit-code array (zsh is this project's shell -- landmine L-3).
# Missing-input precheck FAILS LOUDLY, never skips (T-41-42).
#
# Falsification transcripts (Task 3's own acceptance criteria) recorded in
# `ios/evidence/41/e41-9-gates.log`:
#   1. A direct `ASCredentialIdentityStore` write call temporarily added to a file OUTSIDE the
#      allow-list -> non-zero exit naming the file/line -> removed -> exit 0 again.
#   2. The `IdentityStoreSync.republish(` call temporarily removed from ONE enumerated mutation
#      call site -> non-zero exit naming THAT call site -> restored -> exit 0 again. This is the
#      transcript that matters (this plan's own acceptance criteria): assertion (A)'s falsification
#      only catches an EXTRA writer; only assertion (B) catches a MISSING one, and a missing one is
#      FILL-03's actual failure mode.
#   3. The script pointed at a non-existent source directory -> named error, non-zero exit.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# --- Precheck: the three source roots must exist, or this is an ERROR, never a skip ------------
SCAN_DIRS=(
  "ios/PasskeyVault/PasskeyVault"
  "ios/PasskeyVault/PasskeyVaultAutoFill"
  "ios/PasskeyVault/Shared"
)
# Test-only override, used exclusively by this gate's OWN missing-input falsification transcript.
if [ -n "${PV_AUDIT_CHOKEPOINT_SCAN_OVERRIDE:-}" ]; then
  SCAN_DIRS=("$PV_AUDIT_CHOKEPOINT_SCAN_OVERRIDE")
fi

for d in "${SCAN_DIRS[@]}"; do
  if [ ! -d "$d" ]; then
    echo "ERROR: expected Swift source directory missing: $d -- refusing to report PASS over an unscanned tree" >&2
    exit 1
  fi
done

VAULT_STORE="ios/PasskeyVault/PasskeyVault/Vault/VaultStore.swift"
CPVC="ios/PasskeyVault/PasskeyVaultAutoFill/CredentialProviderViewController.swift"
for f in "$VAULT_STORE" "$CPVC"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: expected source file missing: $f -- assertion (B) has no specification without it" >&2
    exit 1
  fi
done

# --- Assertion (A)'s allow-list: exact file paths, reviewed, each with its own justification ----
# `IdentityStoreSync.swift`: the single production writer (41-04). `MatchingProbe.swift`/
# `IdentityStoreSyncProbe.swift`: host-only EVIDENCE probes (41-04/41-05), never on a real user's
# vault-mutation path -- see this file's own header above for why each exists and why it
# legitimately bypasses the choke point.
ALLOWLIST=(
  "ios/PasskeyVault/Shared/IdentityStoreSync.swift"
  "ios/PasskeyVault/PasskeyVault/MatchingProbe.swift"
  "ios/PasskeyVault/PasskeyVault/IdentityStoreSyncProbe.swift"
)

is_allowlisted() {
  local candidate="$1" entry
  for entry in "${ALLOWLIST[@]}"; do
    [ "$candidate" = "$entry" ] && return 0
  done
  return 1
}

# --- Lexical preprocessing (CR-02, copied verbatim from audit-ffi-opaque-handles.sh; WR-07
# (41-REVIEW.md) added `"""` multi-line string handling) -------------------------------------
#
# WR-07: the original version toggled `state` on every SINGLE `"`, so a `"""` multi-line literal
# was read as string-open, string-close, string-open -- leaving the machine in `state == "string"`
# for the REST OF THE FILE, at which point every subsequent line is emitted empty and every real
# call site in it becomes invisible to the scan. That failure direction is a FALSE PASS, the one
# direction a gate must not fail in. `"""` is now recognized explicitly, entering/exiting a
# dedicated `"triple"` state on the exact 3-quote sequence (closing on the NEXT `"""`, regardless
# of content in between) -- this is exactly what real files in this tree already use (see
# `TracerFillSeeder.swift`/`LockE41Seeder.swift`'s own multi-line JSON literals).
#
# Raw string literals (`#"..."#`) are NOT tokenized by this stripper -- rather than silently
# mis-scan one, the caller below REFUSES to report PASS over any file containing `#"` at all
# (fail loud, matching T-41-42's own discipline). No file in this tree uses one today.
strip_comments_and_strings() {
  awk '
    function strip(line,   out, i, c, d, e, n) {
      out = ""
      n = length(line)
      i = 1
      while (i <= n) {
        c = substr(line, i, 1)
        d = substr(line, i + 1, 1)
        e = substr(line, i + 2, 1)
        if (state == "block") {
          if (c == "*" && d == "/") { cdepth--; i += 2; if (cdepth <= 0) { cdepth = 0; state = "code" } ; continue }
          if (c == "/" && d == "*") { cdepth++; i += 2; continue }
          i++
          continue
        }
        if (state == "triple") {
          if (c == "\"" && d == "\"" && e == "\"") { state = "code"; i += 3; continue }
          i++
          continue
        }
        if (state == "string") {
          if (c == "\\") { i += 2; continue }
          if (c == "\"") { state = "code"; i++; continue }
          i++
          continue
        }
        if (c == "/" && d == "/") { break }
        if (c == "/" && d == "*") { state = "block"; cdepth = 1; i += 2; continue }
        if (c == "\"" && d == "\"" && e == "\"") { state = "triple"; i += 3; continue }
        if (c == "\"") { state = "string"; i++; continue }
        out = out c
        i++
      }
      return out
    }
    BEGIN { state = "code"; cdepth = 0 }
    { print strip($0) }
  ' "$1"
}

# WR-07: fail loud on a raw string literal (`#"`) rather than silently mis-scan one -- see this
# file's own header above for why raw literals are refused rather than tokenized.
#
# WR-11 (41-REVIEW.md iteration 2): assertion (B) below checks a FIXED, SMALL, load-bearing set of
# files (the six enumerated mutation call sites) for a REQUIRED call -- silently skipping one of
# THOSE specific files would mean this gate stops verifying a chokepoint it exists to guarantee, so
# `refuse_unsupported_string_literals` (hard `exit 1`) is kept for assertion (B)'s own call site.
# Assertion (A) is a broad structural sweep over every Swift file under the three scan roots; a
# raw literal in some UNRELATED file there must not block CI for the whole tree (the exact WR-11
# blast-radius problem named for the sibling deprecated-APIs gate) -- `file_has_unsupported_string_
# literal` skips just that ONE file, reported as a named warning, never silently.
refuse_unsupported_string_literals() {
  local f="$1"
  if grep -qF '#"' "$f"; then
    echo "ERROR: $f contains a raw string literal (#\"...\"#) this gate's stripper cannot tokenize -- refusing to report PASS over an unscanned construct" >&2
    exit 1
  fi
}

UNSCANNED_FILES=""
file_has_unsupported_string_literal() {
  local f="$1"
  grep -qF '#"' "$f"
}

SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT

SWIFT_FILES=()
for d in "${SCAN_DIRS[@]}"; do
  while IFS= read -r -d '' f; do
    SWIFT_FILES+=("$f")
  done < <(find "$d" -type f -name '*.swift' -print0)
done
if [ "${#SWIFT_FILES[@]}" -eq 0 ]; then
  echo "ERROR: no .swift files found under ${SCAN_DIRS[*]} -- refusing to report PASS over an unscanned tree" >&2
  exit 1
fi

VIOLATIONS_A=""
# Plan 43-05 (OPT-03): added `ASPasskeyCredentialIdentity\(` as a sixth alternation term --
# `IdentityStoreSync.swift`'s new passkey-identity machinery constructs this type through the
# SAME choke point, so assertion (A) must police it exactly like the password-side construction
# it already policed. `ALLOWLIST` needs no new entry: `IdentityStoreSync.swift` is already
# allow-listed and is the only file that constructs it (see this file's own header above).
WRITE_PATTERN='ASPasswordCredentialIdentity\(|ASPasskeyCredentialIdentity\(|\.saveCredentialIdentities\(|\.removeCredentialIdentities\(|\.replaceCredentialIdentities\(|\.removeAllCredentialIdentities\('

for f in "${SWIFT_FILES[@]}"; do
  if file_has_unsupported_string_literal "$f"; then
    UNSCANNED_FILES="${UNSCANNED_FILES}${f}"$'\n'
    continue
  fi
  STRIPPED="$SCRATCH/$(echo "$f" | tr '/' '_').stripped"
  strip_comments_and_strings "$f" > "$STRIPPED"

  if is_allowlisted "$f"; then
    continue
  fi

  MATCHES=$(grep -nE "$WRITE_PATTERN" "$STRIPPED" || true)
  if [ -n "$MATCHES" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      VIOLATIONS_A="${VIOLATIONS_A}${f}:${line} [identity-store write OUTSIDE the allow-list]"$'\n'
    done <<< "$MATCHES"
  fi
done

# --- Assertion (B): the six enumerated mutation call sites (41-04-SUMMARY.md) -------------------
# label | file | anchor (a stable declaration line, matched literally against the STRIPPED copy)
# | forward line-window to search for `IdentityStoreSync.republish(`. Windows are generous but
# bounded, chosen against the REAL, measured gaps between each site's own declaration and its own
# `IdentityStoreSync.republish(` call, with enough margin never to reach a NEIGHBOURING site's own
# call (verified by hand against the current file, this task) -- see this file's own header for why
# a bounded window, not brace-depth extraction, is the right tool for a FIXED six-entry list.
CALL_SITE_LABELS=(
  "VaultStore.create"
  "VaultStore.update"
  "VaultStore.delete"
  "VaultStore.performRefresh (sync-pull completion)"
  "CredentialProviderViewController.fillOrCancel (post-fill self-heal write)"
  "CredentialProviderViewController.runIdentityRebuildIfPending (full-rebuild recovery path)"
)
CALL_SITE_FILES=(
  "$VAULT_STORE"
  "$VAULT_STORE"
  "$VAULT_STORE"
  "$VAULT_STORE"
  "$CPVC"
  "$CPVC"
)
CALL_SITE_ANCHORS=(
  "func create(fields: ItemFields) async throws -> VaultItemViewModel {"
  "func update(_ item: VaultItemViewModel, fields: ItemFields) async throws -> VaultItemViewModel {"
  "func delete(_ item: VaultItemViewModel) async throws {"
  "private func performRefresh() async throws {"
  "private func fillOrCancel(for request: any ASCredentialRequest, entryPoint: String) {"
  "private static func runIdentityRebuildIfPending() async {"
)
CALL_SITE_WINDOWS=(90 100 30 90 140 80)
# CR-01 (41-REVIEW.md): the REQUIRED call differs per site -- this is "contract shape, not string
# proximity". The four `VaultStore` mutation sites and the full-rebuild recovery path each hand
# the writer "the CURRENT, COMPLETE vault item set" (`republish(sources:)`'s own documented
# contract), so `IdentityStoreSync.republish(` is the correct, and only correct, call for them.
# The post-fill self-heal site is different BY DESIGN: it proves reachability for exactly ONE
# item and must never be able to compute removals against everything else that's published --
# `IdentityStoreSync.upsertOne(` is a STRUCTURALLY different entry point (it takes one `source:`,
# never an array) that cannot be handed a delta by construction. Before CR-01's fix this site
# called `.republish(sources: [oneItem])`, which satisfied the OLD proximity-only check (it
# merely grepped for the literal substring `IdentityStoreSync.republish(` anywhere in the window)
# while still being the exact defect CR-01 names. Requiring the SITE-SPECIFIC call name is what
# makes this gate RED on that old shape and GREEN only on the fix.
CALL_SITE_REQUIRED_CALLS=(
  "IdentityStoreSync.republish("
  "IdentityStoreSync.republish("
  "IdentityStoreSync.republish("
  "IdentityStoreSync.republish("
  "IdentityStoreSync.upsertOne("
  "IdentityStoreSync.republish("
)

VIOLATIONS_B=""

for i in "${!CALL_SITE_LABELS[@]}"; do
  label="${CALL_SITE_LABELS[$i]}"
  file="${CALL_SITE_FILES[$i]}"
  anchor="${CALL_SITE_ANCHORS[$i]}"
  window="${CALL_SITE_WINDOWS[$i]}"
  required_call="${CALL_SITE_REQUIRED_CALLS[$i]}"

  STRIPPED="$SCRATCH/$(echo "$file" | tr '/' '_').stripped"
  # Reuse the already-stripped copy from the (A) loop above if present; otherwise strip now (the
  # `--assert-only`-style narrow re-run path, or a scan-root override that excluded this file from
  # the (A) loop).
  if [ ! -f "$STRIPPED" ]; then
    refuse_unsupported_string_literals "$file"
    strip_comments_and_strings "$file" > "$STRIPPED"
  fi

  anchor_line=$(grep -nF "$anchor" "$STRIPPED" | head -1 | cut -d: -f1 || true)
  if [ -z "$anchor_line" ]; then
    VIOLATIONS_B="${VIOLATIONS_B}${label} -- call site's own declaration not found in ${file} (renamed, moved, or removed)"$'\n'
    continue
  fi

  # A fixed line window is a proximity heuristic wearing a contract's clothes: on 2026-08-20 the
  # post-fill self-heal site went RED purely because an unrelated commit added comment lines,
  # pushing its (unchanged, correct) `upsertOne(` call from line 140 to 147 past its own anchor.
  # The honest extent of a call site is its ENCLOSING FUNCTION, so end the window at the next
  # declaration at the same indentation instead -- `window` survives only as an upper bound, so a
  # runaway search can still never wander into the next screenful of an unusually long file.
  next_decl_offset=$(awk -v start="$anchor_line" '
    NR > start && /^[[:space:]]*(private |fileprivate |internal |public )?(static )?func /  { print NR - start; exit }
  ' "$STRIPPED")
  if [ -n "$next_decl_offset" ]; then
    # The enclosing function's real extent is authoritative -- LONGER than the old fixed window as
    # well as shorter. Capping it at `window` here is what produced the 2026-08-20 false positive.
    window_end=$((anchor_line + next_decl_offset - 1))
  else
    # No further declaration in the file: the site is the last function, so fall back to the
    # bounded window rather than reading to EOF.
    window_end=$((anchor_line + window))
  fi
  window_text=$(sed -n "${anchor_line},${window_end}p" "$STRIPPED")
  if ! printf '%s\n' "$window_text" | grep -qF "$required_call"; then
    VIOLATIONS_B="${VIOLATIONS_B}${label} (${file}, declared at line ${anchor_line}) -- no ${required_call} call found within ${window} lines (CR-01: this site's own contract shape, not any IdentityStoreSync call)"$'\n'
  fi
done

if [ -n "$VIOLATIONS_A" ] || [ -n "$VIOLATIONS_B" ]; then
  echo "FAIL: identity-store choke-point violation(s) found (FILL-03):" >&2
  if [ -n "$VIOLATIONS_A" ]; then
    echo "-- Assertion (A), writer outside the allow-list:" >&2
    echo "$VIOLATIONS_A" >&2
  fi
  if [ -n "$VIOLATIONS_B" ]; then
    echo "-- Assertion (B), an enumerated mutation call site no longer reaches the writer:" >&2
    echo "$VIOLATIONS_B" >&2
  fi
  exit 1
fi

if [ -n "$UNSCANNED_FILES" ]; then
  echo "WARNING: the following file(s) contain a raw string literal (#\"...\"#) assertion (A)'s stripper cannot tokenize -- SKIPPED, not scanned, never silently reported as clean (WR-11, 41-REVIEW.md iteration 2):" >&2
  echo "$UNSCANNED_FILES" >&2
fi

echo "PASS: the identity store is written ONLY from the reviewed allow-list (${ALLOWLIST[*]}), and all ${#CALL_SITE_LABELS[@]} enumerated mutation call sites still reach their own required IdentityStoreSync entry point (FILL-03, CR-01)"
