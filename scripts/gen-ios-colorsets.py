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
ASSETS = os.path.join(ROOT, "ios", "PasskeyVault", "PasskeyVault", "Assets.xcassets")


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

    drift, wrote = [], []
    for t in spec["tokens"]:
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
        print(f"PASS: all {len(spec['tokens'])} colorsets match tokens.json")
        return 0

    if wrote:
        print(f"wrote {len(wrote)} colorset(s): {', '.join(wrote)}")
    else:
        print("no changes — catalog already matches tokens.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
