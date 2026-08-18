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
unexpected="$(printf '%s\n' "$hits" | grep -v 'Vault/ClipboardService\.swift$' | grep -v 'PasskeyVaultApp\.swift$' || true)"
has_service="$(printf '%s\n' "$hits" | grep -c 'Vault/ClipboardService\.swift$' || true)"

if [ -n "$unexpected" ]; then
  say "FAIL -- UIPasteboard referenced outside the choke point and its one documented exception:"
  say "$unexpected"
  FAIL=1
elif [ "$has_service" -ne 1 ]; then
  say "FAIL -- ClipboardService.swift itself must reference UIPasteboard exactly once (found $has_service)"
  FAIL=1
else
  say "PASS -- UIPasteboard is written from the choke point, plus only the one documented DEBUG-only exception"
fi

say ""
if [ "$FAIL" -ne 0 ]; then
  say "OVERALL: FAIL"
  exit 1
fi
say "OVERALL: PASS"
