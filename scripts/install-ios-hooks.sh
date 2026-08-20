#!/usr/bin/env bash
# scripts/install-ios-hooks.sh -- installs QA-05's PREVENTIVE layer: a
# pre-commit hook that delegates to `gsd-tools query check-commit`.
#
# THE HAZARD (see 42-RESEARCH.md "QA-05 is not the problem the ROADMAP
# thinks it is"): `.planning/` is TRACKED in this worktree (1000 files
# inherited from `main` at the fork point), and five of them are modified
# right now. A bare `git commit -a`, or any `git commit` after `git add .`,
# commits milestone-local planning state onto `ios/spike` with no `-A`
# anywhere. `.gitignore` cannot help -- it has zero effect on already-tracked
# paths.
#
# THE SHARED-HOOKS-DIRECTORY HAZARD (ios/IOS-SPIKE-LOG.md landmine L-39,
# decision record IOS-07): `git rev-parse --git-path hooks` resolves to the
# COMMON directory shared by every worktree of this repository, including
# the live `main` worktree, which is owned by a separate, live, autonomous
# v0.5 session that commits `.planning/` legitimately and continuously. A
# hook installed here fires for BOTH worktrees. The installed hook body
# below is therefore written to discriminate by CONFIGURATION --
# `.planning/config.json`'s `commit_docs` key, read via
# `gsd-tools query check-commit` -- and NEVER by branch name, worktree path,
# or `$PWD` string matching. That discrimination is what makes one shared
# hook file safe for two independent sessions: `commit_docs: false` here,
# `commit_docs: true` on `main`, proven by direct execution with `main` as
# cwd BEFORE this installer ever writes anything (E2(a) in the calling
# plan), and re-proven immediately after (E2(b)).
#
# FAIL-OPEN, DISCLOSED AS A COST (ios/IOS-SPIKE-LOG.md IOS-07): when `node`
# or `gsd-tools.cjs` cannot be resolved inside the hook's own (minimal, git-
# provided) environment, the installed hook prints a loud warning to stderr
# and exits 0 rather than blocking every commit in BOTH worktrees over a
# missing interpreter -- including mid-autonomous-run on `main`, which would
# be a strictly worse outcome than a QA-05 preventive gap that the detective
# layer (`scripts/check-ios-gate.sh`'s `gate_qa05`) catches after the fact.
#
# This installer itself is idempotent and non-clobbering: re-running it
# rewrites a hook it previously installed (recognised by the MARKER below),
# but refuses -- non-zero exit, no write -- to overwrite a pre-commit hook
# it did not author, because another session may have installed one there
# first. `--uninstall` removes only a marker-bearing hook; it is the
# reversibility lever for a change whose blast radius reaches a session this
# script does not control.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The marker is checked with a literal substring match (grep -F), never a
# regex, and is the installer's sole means of recognising its own prior
# output -- both for the idempotent-rewrite path and the non-clobber refusal.
MARKER="# installed-by: scripts/install-ios-hooks.sh (passkey-vault-ios, QA-05 preventive layer)"

HOOKS_DIR="$(git rev-parse --git-path hooks)"
if [ ! -d "$HOOKS_DIR" ]; then
  echo "ERROR: git-reported hooks directory does not exist: $HOOKS_DIR" >&2
  exit 1
fi
HOOK_PATH="$HOOKS_DIR/pre-commit"

UNINSTALL=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --uninstall)
      UNINSTALL=1
      shift
      ;;
    *)
      echo "ERROR: unknown argument '$1' (only --uninstall is recognised)" >&2
      exit 1
      ;;
  esac
done

if [ "$UNINSTALL" -eq 1 ]; then
  if [ ! -f "$HOOK_PATH" ]; then
    echo "No hook installed at $HOOK_PATH -- nothing to uninstall"
    exit 0
  fi
  if ! grep -qF "$MARKER" "$HOOK_PATH"; then
    echo "ERROR: refusing to remove $HOOK_PATH -- it does not carry this installer's marker, so it was not authored by this installer" >&2
    exit 1
  fi
  rm -f "$HOOK_PATH"
  echo "Removed marker-bearing hook: $HOOK_PATH"
  exit 0
fi

if [ -f "$HOOK_PATH" ] && ! grep -qF "$MARKER" "$HOOK_PATH"; then
  echo "ERROR: $HOOK_PATH already exists and does not carry this installer's marker -- refusing to overwrite a hook it did not author. Another session may have installed one; merge by hand." >&2
  exit 1
fi

cat > "$HOOK_PATH" <<HOOK
#!/usr/bin/env bash
$MARKER
#
# SHARED HOOK -- this file lives in the git COMMON hooks directory
# (\$(git rev-parse --git-path hooks)) and fires for EVERY worktree of this
# repository, including the live \`main\` worktree at
# /Users/j5on/.work/projects/passkey-vault (the v0.5 autonomous session,
# which commits .planning/ legitimately and continuously). This hook MUST
# NOT break that session.
#
# Discrimination is by CONFIGURATION -- .planning/config.json's
# \`commit_docs\` key, read via \`gsd-tools query check-commit\` -- and NEVER
# by branch name, worktree path, or \$PWD string matching (see
# 42-RESEARCH.md Pitfall 2 and ios/IOS-SPIKE-LOG.md decision record IOS-07
# for why a hand-rolled discriminator was rejected on its merits).
#
# FAIL-OPEN DECISION (ios/IOS-SPIKE-LOG.md IOS-07): when node or gsd-tools
# cannot be resolved, this hook prints a loud warning and exits 0 rather
# than blocking every commit in BOTH worktrees over a missing interpreter.
# That is a disclosed cost, not an oversight -- scripts/check-ios-gate.sh's
# gate_qa05 is the compensating detective layer.
set -uo pipefail

GSD="\$HOME/.claude/gsd-core/bin/gsd-tools.cjs"
NODE="\$(command -v node || true)"

if [ -z "\$NODE" ] || [ ! -f "\$GSD" ]; then
  echo "pre-commit: gsd-tools unavailable (node='\$NODE' gsd='\$GSD'); QA-05 guard SKIPPED -- see ios/IOS-SPIKE-LOG.md IOS-07 fail-open decision" >&2
  exit 0
fi

"\$NODE" "\$GSD" query check-commit
exit \$?
HOOK

chmod +x "$HOOK_PATH"
echo "Installed: $HOOK_PATH"
