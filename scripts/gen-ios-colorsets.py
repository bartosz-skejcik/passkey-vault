#!/usr/bin/env python3
"""
Generate Assets.xcassets colorsets from ios/brand/tokens.json.

Nothing auto-syncs Figma variables into an iOS asset catalog. tokens.json is the join
between the Figma collection 'PV Color' and this catalog; this script is the half that
lands in code.

Usage:
    python3 scripts/gen-ios-colorsets.py            # write
    python3 scripts/gen-ios-colorsets.py --check    # verify catalog matches tokens.json,
                                                    # exit 1 on drift (for CI / Phase 42)

--check is the point of the script existing. A generator nobody re-runs is a generator that
silently drifts; --check turns "did someone hand-edit a colorset" into a failing exit code.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKENS = os.path.join(ROOT, "ios", "brand", "tokens.json")
# `Shared/PVColors.xcassets`, NOT `PasskeyVault/PasskeyVault/Assets.xcassets` (where every
# token used to live). `.planning/debug/passkey-reg-blank-sheet-discord.md` (2026-08-22):
# `Shared/` is a `fileSystemSynchronizedGroups` member of BOTH the `PasskeyVault` app target
# AND the `PasskeyVaultAutoFill` extension target (Xcode 16 synchronized-folder-group project
# format) -- `PasskeyVault/PasskeyVault/Assets.xcassets` was a member of the APP target only,
# so every `Color("PV...")` lookup inside the extension (`PasskeyRegistrationConfirmView.swift`)
# silently failed to resolve (an app extension's asset-catalog lookup runs against its OWN
# main bundle, the `.appex` -- it never falls back to the host app's bundle). Moving the
# GENERATED catalog into `Shared/` makes every token resolve in both targets with ZERO
# project.pbxproj edits and keeps exactly ONE generated catalog -- never a second,
# hand-maintained one. AppIcon/onboarding images stay in the app-only catalog: the extension
# never references them (see `scripts/audit-ios-extension-asset-resolution.py`, the mechanical
# gate that would now catch it if it ever did without also granting catalog access).
ASSETS = os.path.join(ROOT, "ios", "PasskeyVault", "Shared", "PVColors.xcassets")


def components(hex6):
    hex6 = hex6.lstrip("#")
    return {
        "alpha": "1.000",
        "blue": "0x" + hex6[4:6].upper(),
        "green": "0x" + hex6[2:4].upper(),
        "red": "0x" + hex6[0:2].upper(),
    }


def colorset(light, dark):
    """Match the shape Xcode itself writes, so diffs stay readable."""
    return {
        "colors": [
            {
                "color": {"color-space": "srgb", "components": components(light)},
                "idiom": "universal",
            },
            {
                "appearances": [{"appearance": "luminosity", "value": "dark"}],
                "color": {"color-space": "srgb", "components": components(dark)},
                "idiom": "universal",
            },
        ],
        "info": {"author": "xcode", "version": 1},
    }


def main():
    check = "--check" in sys.argv
    with open(TOKENS) as f:
        spec = json.load(f)

    # AccentColor is generated as a MIRROR of PVAccent, not hand-maintained.
    #
    # WHY, and it is the most expensive defect this script has caught. Xcode's
    # template leaves `AccentColor.colorset` as a placeholder with NO colour
    # values:
    #
    #     { "colors": [ { "idiom": "universal" } ], "info": {...} }
    #
    # An empty AccentColor does not fail a build, does not fail a test, and
    # does not fail `audit-ios-colour-tokens.sh` -- that gate finds WRONG
    # colours and MISSING tokens, and this is neither. It is the absence of a
    # value, and the platform's fallback for that absence is SYSTEM BLUE.
    #
    # Consequence, observed on 2026-08-17 in `ios/evidence/38/38-06-list-at-rest
    # .png`: every control that is not explicitly `.tint(...)`-ed rendered
    # blue. The auth and onboarding screens looked correct only because plan
    # 38-13 happened to tint each button by hand; the whole vault surface --
    # tab bar, selected tab label, lock pill -- came out iOS blue in a product
    # whose entire visual identity is a warm coral.
    #
    # Generating it here means the app-wide tint is drift-checked by --check
    # like every other token, and "nobody set the accent" stops being a state
    # this project can be in.
    accent = next((t for t in spec["tokens"] if t["asset"] == "PVAccent"), None)
    if accent is None:
        print("FAIL: tokens.json has no PVAccent token to mirror into AccentColor")
        return 1
    generated = list(spec["tokens"]) + [
        {"asset": "AccentColor", "light": accent["light"], "dark": accent["dark"]}
    ]

    drift, wrote = [], []
    for t in generated:
        path = os.path.join(ASSETS, f"{t['asset']}.colorset")
        target = colorset(t["light"], t["dark"])
        contents = os.path.join(path, "Contents.json")

        current = None
        if os.path.exists(contents):
            with open(contents) as f:
                try:
                    current = json.load(f)
                except json.JSONDecodeError:
                    current = None

        if current == target:
            continue

        if check:
            reason = "missing" if current is None else "differs from tokens.json"
            drift.append(f"{t['asset']}: {reason}")
            continue

        os.makedirs(path, exist_ok=True)
        with open(contents, "w") as f:
            json.dump(target, f, indent=2)
            f.write("\n")
        wrote.append(t["asset"])

    if check:
        if drift:
            print("FAIL: asset catalog has drifted from ios/brand/tokens.json")
            for d in drift:
                print(f"  - {d}")
            print("\nRe-run: python3 scripts/gen-ios-colorsets.py")
            return 1
        print(f"PASS: all {len(generated)} colorsets match tokens.json (incl. generated AccentColor)")
        return 0

    if wrote:
        print(f"wrote {len(wrote)} colorset(s): {', '.join(wrote)}")
    else:
        print("no changes — catalog already matches tokens.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
