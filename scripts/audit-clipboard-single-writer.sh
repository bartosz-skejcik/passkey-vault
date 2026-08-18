#!/usr/bin/env bash
#
# audit-clipboard-single-writer.sh -- CR-03 (38-REVIEW.md) made falsifiable.
#
# The defect: `ItemListView.swift`'s list/context-menu copy path wrote
# `UIPasteboard` directly, bypassing `ClipboardService` entirely -- one of
# the two required clearing mechanisms (T-38-07-01, "Neither alone is
# sufficient") was never armed, the user's configured interval
# (`ClipboardSettings`) was ignored in favour of a hardcoded 40s, and the
# confirmation banner nothing ever rendered.
#
# This script asserts the fix's INVARIANT, not just today's call sites:
# `UIPasteboard` must appear in exactly ONE shipped, non-test Swift file --
# `ClipboardService.swift`, the single choke point every copy affordance is
# required to route through. A future call site writing the pasteboard
# directly (in `ItemListView.swift`, a new screen, or anywhere else) fails
# this gate rather than silently reintroducing CR-03.
#
# Same negative-check discipline as `audit-generator-uses-ffi.sh`: a raw hit
# count is printed, not swallowed by a pipe (`hits="$(grep ... || true)"`,
# never a status read off the end of a pipe -- L-3, `ios/IOS-SPIKE-LOG.md`
# §3).
#
# Usage: scripts/audit-clipboard-single-writer.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHIPPED_SRC=("${ROOT}/ios/PasskeyVault/PasskeyVault" "${ROOT}/ios/PasskeyVault/PasskeyVaultAutoFill")

FAIL=0
say() { printf '%s\n' "$*"; }

say "== check (negative + positive): UIPasteboard appears only in ClipboardService.swift, plus one documented DEBUG-only exception =="
hits="$(grep -rln --include='*.swift' 'UIPasteboard' "${SHIPPED_SRC[@]}" || true)"
count="$(printf '%s' "$hits" | grep -c . || true)"
[ -z "$hits" ] && count=0
say "files: $count"
say "$hits"

# The one permitted exception: `PasskeyVaultApp.swift`'s E-C1 falsification
# arm (`PV_UITEST_CLIPBOARD_DISABLE_BOTH_MECHANISMS`) deliberately writes
# with NEITHER clearing mechanism set, to prove the OTHER arms are watching
# something real -- compiled into DEBUG builds only, inert unless that exact
# env var is set. Any OTHER shipped file (this script's whole reason to
# exist -- `ItemListView.swift` was exactly such a file before CR-03) fails.
#
# WR-04 (38-REVIEW.md, iteration 2): the exemption used to be per-FILE and
# unconditional -- `PasskeyVaultApp.swift` could grow any number of
# `UIPasteboard` writes, in or out of `#if DEBUG`, and this gate stayed
# green. It is precisely the file where the one sanctioned raw write lives,
# so it is the most likely place for a second, undocumented one to land.
# Now: the app-entry file is allowed EXACTLY one hit (`app_hits -eq 1`,
# not "any number"), anchored on the full relative path rather than a bare
# filename suffix (a future `SomethingElsePasskeyVaultApp.swift` no longer
# inherits the exemption), AND that one hit must fall inside an `#if
# DEBUG` region -- a `#if DEBUG` guard is not itself proof the code stays
# out of Release, but a hit found OUTSIDE any `#if DEBUG` region is proof
# it is NOT DEBUG-gated, which is exactly the invariant this gate exists to
# police.
app_swift_rel="ios/PasskeyVault/PasskeyVault/PasskeyVaultApp.swift"

unexpected="$(printf '%s\n' "$hits" | grep -v 'Vault/ClipboardService\.swift$' | grep -v "${app_swift_rel}\$" || true)"
has_service="$(printf '%s\n' "$hits" | grep -c 'Vault/ClipboardService\.swift$' || true)"
app_swift_file="${ROOT}/${app_swift_rel}"
app_hits=0
if [ -f "$app_swift_file" ]; then
  app_hits="$(grep -n 'UIPasteboard' "$app_swift_file" | grep -c . || true)"
fi

# Every `UIPasteboard` hit line in the app-entry file must fall inside an
# `#if DEBUG` region. Tracks `#if`/`#endif` nesting depth with a simple
# stack; a hit is DEBUG-scoped only if the innermost enclosing `#if` at
# that line is literally `#if DEBUG`.
app_hits_outside_debug=0
if [ "$app_hits" -gt 0 ]; then
  app_hits_outside_debug="$(awk '
    /^[[:space:]]*#if[[:space:]]/ {
      depth++
      isDebug[depth] = ($0 ~ /#if[[:space:]]+DEBUG([[:space:]]|$)/) ? 1 : 0
      next
    }
    /^[[:space:]]*#endif/ {
      if (depth > 0) { depth-- }
      next
    }
    /UIPasteboard/ {
      inDebug = 0
      for (d = 1; d <= depth; d++) { if (isDebug[d]) { inDebug = 1 } }
      if (!inDebug) { print NR ": " $0; outside++ }
    }
    END { print "COUNT=" (outside + 0) }
  ' "$app_swift_file" | tail -1 | sed -n 's/^COUNT=//p')"
fi

if [ -n "$unexpected" ]; then
  say "FAIL -- UIPasteboard referenced outside the choke point and its one documented exception:"
  say "$unexpected"
  FAIL=1
elif [ "$has_service" -ne 1 ]; then
  say "FAIL -- ClipboardService.swift itself must reference UIPasteboard exactly once (found $has_service)"
  FAIL=1
elif [ "$app_hits" -ne 1 ]; then
  say "FAIL -- ${app_swift_rel} must contain exactly ONE documented DEBUG-only UIPasteboard write (found $app_hits)"
  FAIL=1
elif [ "${app_hits_outside_debug:-0}" -ne 0 ]; then
  say "FAIL -- ${app_swift_rel}'s UIPasteboard write is not inside an '#if DEBUG' region"
  FAIL=1
else
  say "PASS -- UIPasteboard is written from the choke point, plus only the one documented, exactly-counted, DEBUG-scoped exception"
fi

say ""
if [ "$FAIL" -ne 0 ]; then
  say "OVERALL: FAIL"
  exit 1
fi
say "OVERALL: PASS"
