# Phase 37 — Dynamic Type × Appearance screenshot matrix

**Produced:** 2026-08-12 · **Plan:** 37-04 Task 5 · **Requirements:** ACC-03, ACC-04 (UI half)

This is the single piece of held-out evidence that the **seven backstop `must_haves`** in
`37-04-PLAN.md` point at. Each backstop is mapped to the rows that evidence it at the bottom of this
file. A row is only `PASS` if a screenshot path backs it.

---

## Device substitution — read this before trusting any row

`37-04-PLAN.md` and `37-UI-SPEC.md` both specify **"the narrowest supported device (iPhone SE,
375pt)"**. **No iPhone SE runtime is installed on this machine and none was installed to satisfy this
matrix.** The full set of available iOS 26.5 simulators was: iPhone 17, iPhone 17 Pro, iPhone 17 Pro
Max, iPhone 17e, iPhone Air, and iPads.

Widths were measured empirically (screenshot pixel width ÷ 3× scale), **not** inferred from model
names:

| Device | Pixels | Points | Note |
|---|---|---|---|
| iPhone 17e | 1170×2532 | **390×844** | narrowest available — **used for this matrix** |
| iPhone 17 | 1206×2622 | 402×874 | wider |

**Consequence, stated plainly: this matrix was run at 390pt, 15pt WIDER than the 375pt the contract
specifies.** Every `PASS` below is therefore a slightly weaker result than the backstop asks for. A
layout that passes at 390pt could still clip at 375pt. This is a recorded substitution, not a
satisfied requirement — re-run on a 375pt device before treating the 375pt guarantee as met.

## A failure that nearly shipped as a pass

The first run of this matrix produced 36 files and reported `OK` for every one. **All 36 were
screenshots of the iOS home screen.** `xcrun simctl launch` does not accept `--setenv` on this
toolchain — it parsed the flag as the device argument and the launch failed — but the loop only
checked that a PNG had been written, so every cell "passed".

Fixed by passing env vars through `SIMCTL_CHILD_*` and by adding two guards to the capture loop: the
launch must return a PID, and the app process must still be alive at screenshot time. The lesson is
recorded here rather than in a commit message because it is the same shape this project keeps
catching — *a check that cannot fail is not a check*. Visual inspection, not the loop's own `OK`, is
what caught it.

---

## Capture method

- Device: `iPhone 17e` (`0471FEFF-3537-4047-B072-DF82D1BF4D5D`), iOS 26.5, 390×844pt.
- Appearance: `xcrun simctl ui <dev> appearance light|dark`.
- Type size: `xcrun simctl ui <dev> content_size large` (default) and
  `accessibility-extra-extra-extra-large` (**AX5**, the largest accessibility size).
- State: forced through the `PV_UITEST_SCREEN` / `PV_UITEST_LOCK_STATE` DEBUG-only hooks added in this
  task. **These hooks render a view's layout for a screenshot. They bypass the real
  Keychain/`LAContext` path entirely and therefore claim nothing about biometric ENFORCEMENT** — that
  is 37-05's job, and this matrix must not be read as evidence for it.
- Screenshots: `ios/evidence/37/screens/*.png`, 37 files.

---

## Results — 9 states × {light, dark} × {default, AX5}

`—` = no wrapping/overflow risk in that cell (short strings only).

| State | light/default | light/AX5 | dark/default | dark/AX5 | Verdict |
|---|---|---|---|---|---|
| `AuthView` sign-in | [png](screens/auth-signin-light-dflt.png) | [png](screens/auth-signin-light-a11y.png) | [png](screens/auth-signin-dark-dflt.png) | [png](screens/auth-signin-dark-a11y.png) | **PASS** — whole form fits at AX5 without even needing to scroll; nothing clipped |
| `AuthView` register | not captured | [png](screens/auth-register-light-a11y.png) | not captured | not captured | **PASS (binding cell only)** — see note 1 |
| Lock — idle | [png](screens/lock-idle-light-dflt.png) | [png](screens/lock-idle-light-a11y.png) | [png](screens/lock-idle-dark-dflt.png) | [png](screens/lock-idle-dark-a11y.png) | **PASS** |
| Lock — envelope invalidated | [png](screens/lock-invalidated-light-dflt.png) | [png](screens/lock-invalidated-light-a11y.png) | [png](screens/lock-invalidated-dark-dflt.png) | [png](screens/lock-invalidated-dark-a11y.png) | **MIXED** — see note 2 |
| Lock — biometry locked out | [png](screens/lock-lockedout-light-dflt.png) | [png](screens/lock-lockedout-light-a11y.png) | [png](screens/lock-lockedout-dark-dflt.png) | [png](screens/lock-lockedout-dark-a11y.png) | **MIXED** — same shape as note 2 |
| Lock — biometry denied | [png](screens/lock-denied-light-dflt.png) | [png](screens/lock-denied-light-a11y.png) | [png](screens/lock-denied-dark-dflt.png) | [png](screens/lock-denied-dark-a11y.png) | **MIXED** — same shape as note 2 |
| Lock — KDF processing | [png](screens/lock-processing-light-dflt.png) | [png](screens/lock-processing-light-a11y.png) | [png](screens/lock-processing-dark-dflt.png) | [png](screens/lock-processing-dark-a11y.png) | **PASS** |
| Lock — server-unreachable banner | [png](screens/lock-banner-light-dflt.png) | [png](screens/lock-banner-light-a11y.png) | [png](screens/lock-banner-dark-dflt.png) | [png](screens/lock-banner-dark-a11y.png) | **PASS** — banner wraps, no clip or truncation |
| Lock — forgot-password alert | [png](screens/lock-forgot-light-dflt.png) | [png](screens/lock-forgot-light-a11y.png) | [png](screens/lock-forgot-dark-dflt.png) | [png](screens/lock-forgot-dark-a11y.png) | **PARTIAL** — see note 3 |
| Lock — biometry unavailable | [png](screens/lock-nobiometry-light-dflt.png) | [png](screens/lock-nobiometry-light-a11y.png) | [png](screens/lock-nobiometry-dark-dflt.png) | [png](screens/lock-nobiometry-dark-a11y.png) | **PASS** — biometric slot AND `unlock.orDivider` both omitted entirely; degrades to password-only, not a disabled button and not an error |

Supplementary: [`lock-invalidated-light-a11y-scrolled.png`](screens/lock-invalidated-light-a11y-scrolled.png)
— the same cell after one upward swipe, used to settle note 2.

### Note 1 — register mode, only the binding cell was captured

The `PV_UITEST_SCREEN` hook exposes `auth` (sign-in) only; register mode is reached by tapping the
`auth.toggleToRegister` link, which needs an interactive tap rather than a launch argument. Only the
**binding** cell was driven: light × AX5, the tallest layout at the largest type. It shows the
confirm-password field, both reveal toggles, and `auth.irrecoverableWarning` **wrapping rather than
truncating**, with the remainder reachable by scrolling.

The other three register cells (light/default, dark/default, dark/AX5) are **not captured**. They are
strictly less demanding than the captured one, but that is an argument, not evidence — do not read
them as passed.

### Note 2 — the biometric error states: scroll PASS, "in place" FAIL

At AX5 on 390pt, all three biometric error strings **wrap correctly and are not clipped or
truncated** — the full sentence renders. But the message is long enough that the password field, the
`unlock.submit` CTA and the forgot-password link are all pushed **below the fold**. The initial
viewport shows only the header, the heading, the error copy, and the start of `unlock.orDivider`.

Both views wrap their content in a `ScrollView` (`LockView.swift:40`, `AuthView.swift:37`), and the
scrolled screenshot confirms empirically that the password field, its reveal toggle, the accent-filled
`Unlock` CTA and the forgot-password link are **all reachable by scrolling**. Nothing is unreachable.

So, split honestly:
- The *overflow* guarantee (**scrolls rather than clips**) — **PASS**.
- The *long-text E4* guarantee as literally written (**"wrap IN PLACE in the status slot … without
  pushing the password field or its CTA off-screen"**) — **FAIL**. The CTA is off the initial viewport.

**This was recorded as a FAIL first, and resolved second — in that order, deliberately.**

**RESOLUTION (2026-08-12, Bartek's decision):** the backstop's wording is **amended**, the layout is
not changed. At AX5 on a 390pt screen no layout fits a five-line error plus a labelled field plus a
48pt CTA above the fold, and Apple's own apps scroll here — the original absolute was unachievable,
not merely unmet. The guarantee now reads:

> the three biometric error strings wrap fully at accessibility Dynamic Type on the narrowest
> available device — never clipped and never truncated — and the password field, its CTA and the
> forgot-password link all remain **reachable by scrolling** within the same `ScrollView`. Content
> below the fold is acceptable; content that is clipped, truncated or unreachable is not.

Note what the amendment does **not** do: it does not narrow to "whatever the current build happens to
do". Clipping, truncation and unreachability all still fail it. Under the amended wording this cell is
a **PASS**, evidenced by the scrolled screenshot. The original wording and the measurement that failed
it are kept above so the change is auditable rather than invisible.

### Note 3 — the forgot-password alert body is visibly cut

At AX5 the system `Alert` renders the title and the body wrapping, but the body is **visibly truncated
mid-sentence** ("…No one, including") at the bottom edge of the body area, with the OK button below
it. iOS `UIAlertController` is documented to make a long message body scrollable, which would make the
remainder reachable — **but a scroll inside the alert was not driven, so that is unverified here.**

Recorded as **PARTIAL**, not PASS. The backstop is not discharged by this row alone.

---

## Backstop mapping

| # | Backstop statement (from `37-04-PLAN.md` `must_haves`) | Rows | Verdict |
|---|---|---|---|
| 1 | **Overflow, E1** — at the largest accessibility Dynamic Type size on the narrowest supported device, the sign-in form scrolls rather than clipping | [screens/auth-signin-light-a11y.png](screens/auth-signin-light-a11y.png), [screens/auth-signin-dark-a11y.png](screens/auth-signin-dark-a11y.png) | **PASS at 390pt** (not 375pt — see substitution) |
| 2 | **Overflow, E2** — register mode is the tallest layout and holds the same scroll guarantee | [screens/auth-register-light-a11y.png](screens/auth-register-light-a11y.png) | **PASS at 390pt**, binding cell only (note 1) |
| 3 | **Overflow, E6** — the alert carrying `auth.irrecoverableWarning` scrolls its own body and does not clip the sentence | [screens/lock-forgot-light-a11y.png](screens/lock-forgot-light-a11y.png) | **PARTIAL** — body visibly cut; scroll not driven (note 3) |
| 4 | **Overflow, E8** — banner text wraps and never clips or truncates at accessibility Dynamic Type | [screens/lock-banner-light-a11y.png](screens/lock-banner-light-a11y.png), [screens/lock-banner-dark-a11y.png](screens/lock-banner-dark-a11y.png) | **PASS at 390pt** |
| 5 | **Long text, E4** — *(amended)* strings wrap fully, never clipped or truncated, and the field/CTA/link stay reachable by scrolling | [screens/lock-invalidated-light-a11y.png](screens/lock-invalidated-light-a11y.png), [screens/lock-invalidated-light-a11y-scrolled.png](screens/lock-invalidated-light-a11y-scrolled.png) | **PASS under amended wording** — FAILED as originally worded (note 2) |
| 6 | **Long text, E8** — same in-place wrapping guarantee for the shared banner slot across all message variants | [screens/lock-banner-light-a11y.png](screens/lock-banner-light-a11y.png) | **PASS at 390pt** |
| 7 | **Dark/light, E1–E8** — every screen and state renders correctly in both appearances, every colour from a paired Any/Dark asset | [screens/lock-nobiometry-dark-dflt.png](screens/lock-nobiometry-dark-dflt.png) vs [screens/lock-nobiometry-light-dflt.png](screens/lock-nobiometry-light-dflt.png) | **PASS** |

**Summary: 5 PASS (at 390pt, not 375pt) · 1 PASS binding-cell-only · 1 PARTIAL · 0 outstanding FAIL** (backstop 5 failed as originally worded and was resolved by an audited amendment, not by softening — see note 2).

Two backstops are therefore **not** fully discharged by this artifact — #3 (partial) and
every row's 375pt caveat. At verify time these should surface as unmet rather than pass silently; that
surfacing is the intended honest-verifier behaviour, not over-flagging.

## What this artifact does NOT prove

- **Nothing about biometric enforcement.** Every lock state here was forced through a DEBUG hook that
  never touches `SecItemCopyMatching` or `LAContext`. ACC-04's enforcement question belongs to 37-05.
- **Nothing at 375pt.** See the substitution section.
- **Nothing on physical hardware.** Simulator only (MP-1).
