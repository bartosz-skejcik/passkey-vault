# E41-3 — How iOS matches `.domain` and `.URL` service identifiers (DR-41-B evidence)

Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-05, Task 1. Driven by
`scripts/ios-autofill-e41.sh e41-3`; raw evidence in `ios/evidence/41/e41-3-raw.log`. Per this
task's own must_haves: **this file is a recorded table of real observations, not a pass/fail
verdict on the experiment itself.**

## Design

Three identities registered for the same probe item (`recordIdentifier=e41-3-probe-item`),
distinguished only by `user`:

| Identity | Type | Registered service identifier | `user` (discriminator) |
|---|---|---|---|
| A | `.domain` | `e413.localhost` | `e413-a-domain-9f2c@pv.test` |
| B | `.URL` | `http://e413.localhost:8091/` | `e413-b-url-9f2c@pv.test` |
| C | `.URL` | `http://e413.localhost:8092/` | `e413-c-url-9f2c@pv.test` |

Registration is direct via `ASCredentialIdentityStore.shared.saveCredentialIdentities`
(`MatchingProbe.swift`, host app target), bypassing `IdentityStoreSync` deliberately — production
registers `.domain`-typed identities only, and this experiment's whole point is to observe
`.URL`-typed matching, which production does not exercise.

**Port note, stated here and in every place this matters (never softened in only one place):**
this harness has no non-interactive root on the host Mac (`sudo -n true` checked live this
session, requires a password), so binding TCP 80/443 — the literal IANA default ports for
http/https — is not possible without an interactive prompt, which this project's own "no
interactive prompts in automation" rule forbids for a routine, repeatable experiment. Every
location below therefore uses an explicit, non-privileged port. "The port identity B declares"
(8091) stands in for "the default-port location" the plan's own text names; identity C's port
(8092) is the explicit non-default-port comparison. `*.localhost` hostnames resolve to loopback
with **no** `/etc/hosts` edit and **no** root (RFC 6761 — confirmed live via `ping
pv-e413.localhost` / `ping sub.pv-e413.localhost`, both resolving to 127.0.0.1 unconditionally).
The "other scheme" location (loc2) uses a throwaway, session-local CA + leaf certificate
(`openssl`, SAN covering every `*.localhost` host used here), trusted into the **simulator's own**
keychain via `xcrun simctl keychain <udid> add-root-cert` — device-scoped, no host-Mac root
needed. Because a plain-HTTP and a TLS listener cannot share one TCP port, loc2 necessarily runs
on a *third* port (8093) rather than literally "8091 but https" — this means the scheme comparison
(loc1 vs loc2) also changes port, a confound named explicitly in "What this does NOT settle" below.

Five locations visited, in one continuous Safari-driving XCUITest run
(`AutoFillMatchingUITests.testE41_3AllLocations`):

| Label | URL | Tests |
|---|---|---|
| loc1 | `http://e413.localhost:8091/` | same host+scheme+port as B's registration |
| loc2 | `https://e413.localhost:8093/` | same host as A/B, other scheme (confounded with port, see above) |
| loc3 | `http://sub.e413.localhost:8091/` | subdomain of A/B's host, same scheme+port as loc1 |
| loc4 | `http://e413.localhost:8092/` | same host+scheme as B, but C's own declared port |
| loc5 | `http://e413-unreg.localhost:8091/` | **the unregistered-location control** — nothing registered for this host at the time of the primary drive |

Observation method: for each location, Safari is terminated and relaunched fresh, navigated to the
URL, the username field tapped, and the resulting UI scanned for any of the three discriminator
strings — first the direct "Sign in to ..." sheet, then (if absent) the "Passwords" keyboard
accessory and its own provider-detail sheet. A full accessibility-hierarchy dump is captured to
the evidence log whenever nothing matches, so a genuinely unanticipated UI shape is diagnosable
rather than silently recorded as a bare "NONE" with no way to tell "nothing was offered" apart
from "something was offered in a shape this harness did not anticipate." Every observation and its
timestamp are printed to the driving XCUITest's own STDOUT (`PVUITEST|E41-3|...`), captured in the
raw `xcodebuild test` transcript.

## Observed table

This drive was run three complete times (three independent `removeAll +
saveCredentialIdentities([A,B,C])` registrations, three full five-location sweeps). The table
below is the FINAL replication (`ios/evidence/41/e41-3-raw.log`, the file this evidence directory
currently holds); the per-replication variation at loc1/loc2 is recorded in Note 1 rather than
averaged away.

| Location | A (`.domain e413.localhost`) | B (`.URL http://…:8091/`) | C (`.URL http://…:8092/`) |
|---|---|---|---|
| loc1 `http://e413.localhost:8091/` | `not offered` (this replication); `e413-a-domain-9f2c@pv.test` in 1 of the other 2 replications — Note 1 | `not offered` in all 3 replications | `not offered` in all 3 replications |
| loc2 `https://e413.localhost:8093/` | `not offered` (this replication); `e413-a-domain-9f2c@pv.test` in 2 of the other 2 replications — Note 1 | `not offered` in all 3 replications | `not offered` in all 3 replications |
| loc3 `http://sub.e413.localhost:8091/` | `e413-a-domain-9f2c@pv.test` in **all 3** replications | `not offered` in all 3 replications | `not offered` in all 3 replications |
| loc4 `http://e413.localhost:8092/` | `e413-a-domain-9f2c@pv.test` in **all 3** replications | `not offered` in all 3 replications | `not offered` in all 3 replications |
| loc5 `http://e413-unreg.localhost:8091/` (unregistered control) | `e413-a-domain-9f2c@pv.test` in **all 3** replications — **the control did not come back clean**, see Note 2 | `not offered` in all 3 replications | `not offered` in all 3 replications |

Raw citations (`ios/evidence/41/e41-3-raw.log`, current file, the third/final replication):
registration — `:2` (`stage=register status=ok count=3`); loc1–loc5 — `:177,179,186,193,200`; the
"Sign in to …" sentence text for loc3–loc5 always names `e413.localhost` and
`e413-a-domain-9f2c@pv.test` verbatim, e.g. `Sign in to "e413.localhost" with your password for
"e413-a-domain-9f2c@pv.test" saved in "PasskeyVault"?`. The two earlier replications (identical
methodology, superseded by this file on re-run) showed, respectively: (1) `A,A,A,A,A` across
loc1–5; (2) `NONE,A,A,A,A`. Combined with this replication's `NONE,NONE,A,A,A`, loc3/loc4/loc5 are
offered in 3/3 replications; loc1 in 1/3; loc2 in 2/3.

**Note 1 — loc1/loc2's own inconsistency across three replications, always resolving to "offered"
by loc3 onward.** loc1 (visited FIRST, immediately after a fresh registration) and loc2 (visited
second) are the only locations that ever show `NONE` — and only in SOME replications. loc3, loc4,
and loc5 (visited third, fourth, fifth — seconds to tens-of-seconds after registration) show
identity A in **every** replication with no exception. The simplest reading: the system's own
suggestion index takes a short, variable time to catch up after a registration write — long enough
to occasionally miss loc1 or loc2, never long enough to still be missing by loc3. This was not
independently isolated with a controlled delay sweep (see "What this does NOT settle").

**Note 2 — the unregistered-location control did not come back clean, and that is itself the
single most important finding of this experiment.** The plan's own must_haves require: *"no
suggestion from our provider appears there — the control that makes every positive row in the
table mean something."* Under the standard A+B+C registration, loc5 shows identity A **every
single time**, exactly like every other location. This is not a harness bug — three separate
navigation, tap, and full-hierarchy-dump cycles all confirm the address bar genuinely shows
`e413-unreg.localhost` (a host sharing NOTHING with `e413.localhost` beyond both ending in
`.localhost`) at the moment the "Sign in to ⁦e413.localhost⁩ …" sentence appears. **Once
identity A's registration has propagated, it is offered completely independent of the visited
host — not "broader than origin equality," not "collapsed to a shared suffix," but apparently
unconditional for ANY http(s) page with a password field, on this simulator/toolchain.** See the
falsification section below for the (unsuccessful, honestly reported) attempts to isolate the
exact mechanism.

## Falsification attempts (the control's own validity)

The plan's own acceptance criteria specify a falsification: register an identity for the
unregistered location, observe a suggestion appear, remove it, confirm the row reverts. Three
attempts were made; **none succeeded in the way the plan anticipated, and that failure is itself
recorded rather than glossed over.**

1. **Against the A+B+C baseline** (`ios/evidence/41/e41-3-raw.log:202-219`): registered a
   throwaway `.domain` identity for `e413-unreg.localhost`, re-visited loc5 — result:
   `e413-a-domain-9f2c@pv.test` (identity A), not the throwaway identity's own username. Removed
   the throwaway identity, re-visited loc5 — same result, identity A again. **Uninterpretable**:
   identity A's own unconditional presence (Note 2) masks any location-specific signal a second
   identity's registration/removal could otherwise produce.
2. **Against a clean, A-free baseline** (`registerUrlOnly()` — only B, C registered;
   `:394,565`): loc1 (B's own exact registered address) and loc5 (unregistered) both show `NONE`.
   This at least confirms B is never offered even at its own address, and that nothing is offered
   at an unregistered host when no `.domain` identity exists at all — a genuinely clean negative,
   but it does not distinguish "true negative" from "`.URL`-typed identities are simply never
   surfaced by this mechanism," so it settles the `.URL`-vs-`.domain` question (see Key Findings)
   without settling the control-falsification question.
3. **The corrected control-probe, run against the clean B+C baseline**
   (`:567-919`; also re-verified live, twice more, outside the main drive, once immediately after
   registration and once several minutes later): registered a throwaway `.domain` identity for
   `e413-unreg.localhost` via a bare, additive `saveCredentialIdentities([identity])` call (no
   preceding `removeAll`) — loc5 showed `NONE`, not the throwaway identity, in **every** repeat,
   including after an 8+ minute wait. Removed it — still `NONE`. **This falsification did not
   reproduce the plan's expected shape at all**: an additive, single-identity save was never
   observed to produce a visible suggestion in this harness, in contrast to identity A's own
   registration (a `removeAllCredentialIdentities()` + batch `saveCredentialIdentities([A,B,C])`
   call), which propagated within seconds. The two registration shapes differ in more than one way
   (batch vs. single, preceded-by-clear vs. not) and this experiment did not isolate which
   difference matters. Production's own `IdentityStoreSync.republish` never performs a bare
   additive single-item save without its own full-set bookkeeping (`republishIncremental`/
   `republishFullReplacement`), so this specific probe artifact may not generalize to production's
   write path — recorded as an open question, not resolved here.

## Key findings

- **`.domain`-typed matching, once propagated, is not observably bounded by host at all on this
  simulator/toolchain** — offered on the same host+port (loc1), the same host under a different
  scheme (loc2), a subdomain (loc3), the same host on a different port (loc4), and a **completely
  unrelated host** (loc5). This is strictly broader than the RESEARCH's own worst-case framing
  ("offered on `http://example.com` and on `example.com:8443`" — same-host variants only). DR-41-B
  must be written against this actual breadth, not the narrower one originally anticipated.
- **`.URL`-typed identities were never offered through this suggestion mechanism at all**, in any
  of five direct tests (B at loc1, its own exact registered address; B/C at loc5 twice more) — not
  "collapsed to host," not "narrower than `.domain`," simply absent from every observation this
  harness could make. `DR-41-B(b)` (`.URL` identities as the primary registration type) is off the
  table per the plan's own REPLANNING TRIGGER, on stronger grounds than that trigger anticipated.
- **The extension's own code was never invoked to produce any of these suggestions.**
  `xcrun simctl spawn log show --predicate 'subsystem == "cloud.blonie.PasskeyVault"'` across the
  whole drive (registration through the final falsification leg) shows **zero** `PasskeyVaultAutoFill`
  process activity. The "Sign in to …" sheet is populated by the SYSTEM directly from
  `ASCredentialIdentityStore`'s own registered metadata — confirming F3's own framing
  (`41-RESEARCH.md`: "QuickType matching against registered identities is performed by the system,
  not by us") and confirming the fill entry points (`provideCredentialWithoutUserInteraction`,
  `prepareInterfaceToProvideCredential`) are the ONLY place this repo's own policy can be
  re-applied — there is no way to narrow the suggestion set itself.

## What this does NOT settle

- **The exact mechanism behind `.domain`'s unconditional breadth.** Three candidate explanations
  were not distinguished: (a) genuine host-independent matching for `.domain` type on this
  simulator; (b) a "there is exactly one saved password, offer it as a generic fallback on any
  password field" UX heuristic specific to a sparse identity store; (c) some rank-based behaviour
  (identity A was registered with `rank = 0`, the lowest/highest-priority value). Distinguishing
  these needs a device with a large, realistic password store, which this harness does not have.
- **Whether the literal IANA default ports (80/443) behave identically to the substituted
  non-privileged ports used here.** Not reachable on this harness (see Design, above) — no root,
  no interactive prompt permitted for a routine run.
- **The scheme-only comparison, cleanly isolated from port.** loc1→loc2 changes both scheme AND
  port (a plain-HTTP and a TLS listener cannot share one TCP port on this harness) — the
  `.domain` identity's own scheme-and-port-blind behaviour (offered at both) is suggestive but not
  a clean single-variable test.
- **Why the additive, single-identity `saveCredentialIdentities` call (Falsification 3) was never
  observed to produce a suggestion**, in contrast to the batch `removeAll + save` registration
  that did. Not isolated to a single cause; flagged as an open question for any future plan that
  needs to reason precisely about `IdentityStoreSync`'s own incremental-write path
  (`republishIncremental`).
- **loc1's own three-way inconsistency** (Note 1) — plausibly registration-propagation timing, not
  independently confirmed with a controlled delay sweep.
- **Any location that could not be reached on the simulator at all.** None — every one of the five
  locations plus the three falsification legs loaded a real page with a real username/password
  form; no location was unreachable outright (unlike the port-80/443 substitution above, which is
  a design constraint, not a load failure).
- **Real-device behaviour.** Everything above is simulator-observed. 37-RESEARCH's own Open
  Question 1 ("does the iOS 26.5 simulator enforce a Keychain ACL at all?") is a reminder that this
  simulator's enforcement fidelity for unrelated subsystems has already been found looser than a
  real device's; this experiment does not independently rule out the same possibility for
  `ASCredentialIdentityStore` matching.

## Feeds into

- `DR-41-B` (`ios/IOS-SPIKE-LOG.md` §1) — the decision this table is committed against.
- Task 2's `CredentialMatcher` — the load-bearing consequence of "the extension is never invoked
  during suggestion population, and `.domain` breadth is effectively unbounded": full origin
  equality MUST be re-applied at the one place iOS hands the fill entry point a target
  (`request.credentialIdentity.serviceIdentifier`), because the suggestion set itself provides
  **no** host-based filtering to rely on.
