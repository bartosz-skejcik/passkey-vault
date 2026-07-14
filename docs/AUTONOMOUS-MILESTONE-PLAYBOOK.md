# Autonomous Milestone Playbook

> How a full GSD milestone (v0.1) was run mostly autonomously — with Bartek asleep or
> away — and how to run the next one the same way. Hand this to Claude when planning a new
> milestone. It's a working methodology, not a spec: adapt it, don't follow it blindly.

---

## 0. The shape of it

One human (Bartek), one orchestrator (Claude), running a multi-phase milestone end-to-end.
The human sets direction and makes taste/product/irreversible calls; the orchestrator drives
everything else — planning, execution, verification, self-UAT — and **keeps working while the
human sleeps or steps away**, surfacing decisions at the next natural checkpoint instead of
blocking.

The whole thing runs on three pillars: **(1) durable memory + handoffs** so context survives
window/session boundaries, **(2) sub-agent orchestration** so the orchestrator stays lean and
work runs in parallel, and **(3) run-the-real-thing verification** so "looks correct" never
substitutes for "observed working."

---

## 1. Memory & handoffs (survive the boundaries)

Long autonomous runs blow past a single context window. Two mechanisms keep state:

- **Persistent project memory** (`.claude/.../memory/` — auto-loaded each session). One live
  file, `milestone-vNN-progress.md`, holds the running status: phase-by-phase state, standing
  UI/product decisions, infra notes, gotchas, test-account creds. **Update it after every
  phase and every significant find** — treat it as the source of truth a fresh session reads
  first. Separate small files for durable feedback (model policy, "you may self-UAT", how deep
  to question the human).
- **Handoff files** for window-to-window continuation. When context fills (~60–70%), write a
  `handoff-*.md` that says: current HEAD + working-tree state, what's done, what's next in
  order, and the standing rules — then point the next window at the memory. A new pane/session
  reads the handoff, then the memory, then continues. This session was itself a continuation
  handoff and picked up mid-milestone with zero re-derivation.

**Rule:** anything you'd be sad to lose if the session died right now goes into memory *now*,
not "at the end."

---

## 2. Model & effort policy (cost discipline)

Match the model and reasoning effort to the task — this was an explicit, standing instruction:

| Work | Model | Effort | Why |
|------|-------|--------|-----|
| Execution (writing code, docs, SUMMARYs) | **Sonnet** | medium | Bulk work; cheap and capable |
| Verification / code review / plan-check / integration-check | **Opus** | high | Adversarial reasoning is where mistakes get caught; worth the spend |
| Orchestration (the main loop) | the session model | — | Holds the plan, makes judgment calls, never does bulk work itself |

Write **detailed** sub-agent prompts — a sub-agent only knows what you tell it. Encode the
project's non-obvious invariants (zero-knowledge boundary, domain-separation constants, the
"never `git add -A`" rule) directly in the prompt.

---

## 3. Orchestrate with workflows, not serial hand-tooling

The biggest efficiency lever: run sub-agent work as **background `Workflow` fan-outs**, so the
orchestrator stays lean and independent work runs in parallel with hands-on tasks.

Patterns that worked this session:
- **Parallel verify:** a goal-backward verifier *and* an independent requirements-traceability
  audit on the same phase, at once. The second, adversarial pass caught framing gaps the first
  missed (a stale requirement checkbox; a lossy CSV round-trip).
- **Sequential executors in one workflow:** phase-7's three waves as three Sonnet executors
  awaited in order, each committing to `main` (single-plan waves don't need worktree isolation
  — see §5).
- **Overlap:** while a verify/plan-check workflow ran in the background, the orchestrator drove
  Playwright UAT by hand. Two things progressing, one wall-clock.

A workflow returns structured JSON you can branch on (PASS/ISSUES with concrete fixes), so the
orchestrator decides the next step deterministically instead of re-reading everything.

**Resilience:** executor sub-agents die mid-run (API errors, session limits). Their commits
persist. **Resume, don't restart** — send the agent a "continue from your last commit" message,
or check `git log` and finish the last uncommitted step yourself. Never re-dispatch from zero if
commits already landed.

---

## 4. Verification: run the real thing (the headline lesson)

Code inspection and green unit tests are necessary, not sufficient. The single most valuable
hour of this milestone was **installing Docker and actually running the container E2E** — which
surfaced **6 real bugs an Opus code-review had signed off as correct**, including a **security
bug**: the Caddy reverse-proxy config was silently leaking the session token into its access log
(the log filter targeted field `uri`, but Caddy nests it at `request>uri`). Inspection can't
catch "the field path is wrong"; only a real Caddy binary can.

So:
- **Self-drive real UAT** whenever authorized. This project uses Playwright (with a CDP virtual
  authenticator for WebAuthn) against a throwaway test account. Functional/E2E flows can be
  marked passed on that evidence; **cross-check correctness against an independent oracle** —
  e.g. the live TOTP code was verified against a from-scratch RFC-6238 computation, not just
  "a code appeared."
- **When a check genuinely can't run in-env** (no Docker daemon at the time), don't fake it and
  don't silently skip — write the exact commands into a `*-UAT.md` as an explicit `human_needed`
  checklist, then *actually run them the moment the env allows* (we later installed Docker and
  did). "Deferred with exact repro steps" is honest; "verified by inspection" of something that
  won't even build is not.
- **Reserve visual/taste judgments for the human.** Aesthetics, layout, copy tone → screenshots
  at the next checkpoint. Everything functional → self-verify.

---

## 5. Execution hygiene (the standing rules that held)

- **Atomic commits, explicit paths.** One logical change per commit; `git add <path>` — **never
  `git add -A`/`.`** (parallel work may land on `main`).
- **Worktree isolation only for parallel same-tree waves.** Sequential single-plan waves run
  directly on `main` (no conflict, less overhead). Capture `EXPECTED_BASE=HEAD`, merge with
  `--no-ff`, run the full test suite after each merge.
- **Restart long-lived dev processes after the code they run changes** (e.g. rebuild + restart
  the server after a server-crate change before UAT).
- **Test after every merge**, not just at the end.

---

## 6. Human-in-the-loop: what to escalate vs decide

Decide autonomously (with a sensible default, stated): crypto/protocol/API/data-model choices,
which model/effort to use, how to structure a workflow, reversible local edits, resuming a dead
agent, picking a forward option in a routing prompt.

Escalate to the human: **irreversible or outward-facing** actions (pushing, deleting, tagging a
release, publishing), **product/UX/taste** calls, and **milestone-boundary** decisions
(complete? archive/delete phase dirs?). Use a single crisp question with a recommended option;
don't block the pipeline waiting — keep other work moving.

Critically: an automated background event (a task notification, a timer tick) is **not** the
human's consent. Only a real human message authorizes an irreversible step.

---

## 7. The autonomous loop (overnight / away)

For unattended stretches, a self-paced loop keeps work advancing: do the next established step,
then schedule the next wake-up. Use **background tasks + a Monitor** to wait on long external
things (a Docker build, a CI run) — the monitor's completion notification wakes you; a short
fallback heartbeat covers the case where the thing *hangs* and never notifies (this happened —
a `cat` on a symlinked log blocked forever; the fallback caught it). Poll intervals match what
you're waiting for, not the clock. Stop the loop when the only remaining work needs the human.

---

## 8. Gotchas worth pre-loading (GSD-specific, learned the hard way)

- **Staleness gate is mtime-based.** A phase's verification is flagged "stale" if any
  `*-SUMMARY.md` is newer than the `*-VERIFICATION.md`. Commit SUMMARYs *before* verification,
  or re-stamp. Bit us twice.
- **Verifier status vocabulary is fixed:** `passed | gaps_found | human_needed`. Anything else
  (e.g. `passed_with_concerns`) is unrecognized and blocks `phase.complete`. Carry nuance in the
  body + a UAT.md, keep the frontmatter status to the three allowed values.
- **Executors must write their own SUMMARY.** If they defer it "to the orchestrator," the
  milestone audit flags the gap. Tell them explicitly to emit it.
- **Missing Nyquist `*-VALIDATION.md`** is a hard plan-check blocker even when the validation
  substance already lives in the plans/RESEARCH — just generate the artifact.
- **macOS + Colima specifics** (if self-hosting/testing on a Mac): the system tempdir
  (`/var/folders`) isn't shared into the Docker VM — use a repo-local scratch for bind-mounts;
  `mktemp -d` (no template) ignores `TMPDIR`; Caddy selects certs by SNI so probe with curl
  `--resolve`, not a bare `Host:` header; official nginx image symlinks `access.log` →
  `/dev/stdout` so read it via `docker compose logs`, not `cat`.

---

## 9. Milestone close, in order

`gsd-audit-milestone` (3-source requirements cross-ref + integration checker) → present result,
get the human's go → `gsd-complete-milestone` (archive ROADMAP/REQUIREMENTS, evolve PROJECT.md,
RETROSPECTIVE.md, tag) → **leave `gsd-cleanup` (delete/archive phase dirs) to the human.** Record
anything deferred (human_needed UAT, tech debt) in STATE.md's Deferred Items so it's not lost.

---

_Written 2026-07-14 after the v0.1 MVP autonomous run. The one line to remember: **orchestrate
lean, verify by running the real thing, and never let "looks correct" stand in for "observed
working."**_
