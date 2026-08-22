#!/usr/bin/env python3
"""
measure-ios-color-token.py -- proves a PV colour TOKEN actually painted pixels on
screen, from a screenshot, in HEX. Never `exists`/`isHittable`, never eyeballing.

WHY THIS EXISTS. `.planning/debug/passkey-reg-blank-sheet-discord.md` (2026-08-22):
`PasskeyRegistrationConfirmView.swift`'s accessibility identifiers
(`passkeyRegistration.confirm`/`.cancel`) are genuinely present in the accessibility
tree whether or not `Color("PVAccent")`/`Color("PVBackground")` actually resolved --
an app extension's asset-catalog lookup silently DEGRADES rather than fails when the
named colorset is not compiled into that target's own bundle (`.appex`), so an
XCUITest assertion built on `element.exists` can pass on a screen that painted
nothing legible. This script is the missing half: it reads the actual pixels of a
captured screenshot and asserts a named token's real hex value is (or is not)
present as a genuine, non-trivial-area fill -- not a single anti-aliased edge pixel.

METHOD. Subsampled full-image scan (stride, default 3px in each direction -- large
enough to stay fast on a 1178x2556 @3x capture, small enough that a real UI fill
(a full-width background, a 50pt-tall button) is sampled thousands of times; a
thin 1-2px anti-aliased edge is not, which is the point). Every sampled pixel is
bucketed into an exact-hex histogram. For each `--expect NAME=HEX`, every histogram
bucket within `--tolerance` (per-channel, default 6, absorbs sRGB/anti-aliasing
rounding) of HEX is summed; the token is "present" iff that sum >= `--min-samples`
(default 200 -- calibrated to reject a handful of edge-antialiasing pixels while
passing any real fill region at this stride).

`--mode present` (default): every `--expect` token must be found -- the GREEN proof.
`--mode absent`: every `--expect` token must NOT be found -- the RED proof (used
BEFORE a fix, to show the tokens are genuinely unresolved, not merely "close enough
to check casually").

Stdlib only, `sips`-via-BMP decode -- identical technique to
`scripts/measure-ios-dock-panel.py`'s own `Bitmap` class (this machine's python3
is externally-managed, PEP 668; no Pillow). Deliberately NOT shared code with that
script (this project's own established discipline: no shared framework between
one-off measurement scripts -- see `NativeAppRegisterUITests.swift`'s header for
the identical rationale applied to UI test helpers) -- it is ~60 lines and the two
scripts measure conceptually different things (geometry vs. colour identity).

Usage:
  scripts/measure-ios-color-token.py <screenshot.png> --expect NAME=HEX [--expect NAME=HEX ...]
      [--mode present|absent] [--tolerance N] [--min-samples N] [--stride N] [--verbose]
  scripts/measure-ios-color-token.py --self-test
"""
import os
import struct
import subprocess
import sys
import tempfile


class Bitmap:
    """A decoded image as a flat RGB row list. See this file's own header for why
    this is stdlib-only sips-via-BMP rather than Pillow."""

    def __init__(self, width, height, rows):
        self.width = width
        self.height = height
        self._rows = rows  # top-down, each a list of (r, g, b)

    def pixel(self, x, y):
        return self._rows[y][x]

    @classmethod
    def from_png(cls, path):
        with tempfile.TemporaryDirectory() as tmp:
            bmp = os.path.join(tmp, "shot.bmp")
            subprocess.run(
                ["sips", "-s", "format", "bmp", path, "--out", bmp],
                check=True, capture_output=True,
            )
            return cls._from_bmp(bmp)

    @staticmethod
    def _from_bmp(path):
        with open(path, "rb") as f:
            data = f.read()
        if data[:2] != b"BM":
            raise ValueError(f"{path}: not a BMP")
        pixel_offset = struct.unpack_from("<I", data, 10)[0]
        width, height = struct.unpack_from("<ii", data, 18)
        bpp = struct.unpack_from("<H", data, 28)[0]
        if bpp not in (24, 32):
            raise ValueError(f"{path}: {bpp}-bpp BMP is not supported")
        stride = ((width * bpp // 8) + 3) // 4 * 4
        step = bpp // 8
        top_down = height < 0
        height = abs(height)
        rows = []
        for row in range(height):
            src = row if top_down else (height - 1 - row)
            base = pixel_offset + src * stride
            rows.append([
                (data[base + x * step + 2], data[base + x * step + 1], data[base + x * step])
                for x in range(width)
            ])
        return Bitmap(width, height, rows)


def hex_to_rgb(hex6):
    hex6 = hex6.lstrip("#")
    return (int(hex6[0:2], 16), int(hex6[2:4], 16), int(hex6[4:6], 16))


def rgb_to_hex(rgb):
    return "%02X%02X%02X" % rgb


def histogram(bitmap, stride):
    counts = {}
    for y in range(0, bitmap.height, stride):
        row = bitmap._rows[y]
        for x in range(0, bitmap.width, stride):
            counts[row[x]] = counts.get(row[x], 0) + 1
    return counts


def matches_within_tolerance(rgb, target, tolerance):
    return all(abs(rgb[i] - target[i]) <= tolerance for i in range(3))


def sum_matches(counts, target_hex, tolerance):
    target = hex_to_rgb(target_hex)
    total = 0
    for rgb, n in counts.items():
        if matches_within_tolerance(rgb, target, tolerance):
            total += n
    return total


def parse_expect(spec):
    if "=" not in spec:
        raise ValueError(f"--expect must be NAME=HEX, got: {spec}")
    name, hexval = spec.split("=", 1)
    hexval = hexval.lstrip("#").upper()
    if len(hexval) != 6:
        raise ValueError(f"--expect hex must be 6 hex digits, got: {hexval} (from {spec})")
    int(hexval, 16)  # raises ValueError if not valid hex
    return name, hexval


def run(argv):
    if not argv or argv[0].startswith("--"):
        print("ERROR: first argument must be a screenshot PNG path", file=sys.stderr)
        return 1
    png_path = argv[0]
    rest = argv[1:]

    expects = []
    mode = "present"
    tolerance = 6
    min_samples = 200
    stride = 3
    verbose = False

    i = 0
    while i < len(rest):
        arg = rest[i]
        if arg == "--expect":
            expects.append(parse_expect(rest[i + 1]))
            i += 2
        elif arg == "--mode":
            mode = rest[i + 1]
            i += 2
        elif arg == "--tolerance":
            tolerance = int(rest[i + 1])
            i += 2
        elif arg == "--min-samples":
            min_samples = int(rest[i + 1])
            i += 2
        elif arg == "--stride":
            stride = int(rest[i + 1])
            i += 2
        elif arg == "--verbose":
            verbose = True
            i += 1
        else:
            print(f"ERROR: unknown argument '{arg}'", file=sys.stderr)
            return 1

    if mode not in ("present", "absent"):
        print(f"ERROR: --mode must be 'present' or 'absent', got: {mode}", file=sys.stderr)
        return 1
    if not expects:
        print("ERROR: at least one --expect NAME=HEX is required", file=sys.stderr)
        return 1
    if not os.path.exists(png_path):
        print(f"ERROR: screenshot not found: {png_path}", file=sys.stderr)
        return 1

    bitmap = Bitmap.from_png(png_path)
    counts = histogram(bitmap, stride)
    total_samples = sum(counts.values())

    if verbose:
        top = sorted(counts.items(), key=lambda kv: -kv[1])[:10]
        print(f"-- {png_path}: {bitmap.width}x{bitmap.height}, {total_samples} samples (stride={stride}), top colours:")
        for rgb, n in top:
            print(f"   #{rgb_to_hex(rgb)}: {n}")

    fail = False
    for name, hexval in expects:
        n = sum_matches(counts, hexval, tolerance)
        found = n >= min_samples
        if mode == "present":
            ok = found
            verdict = "PASS" if ok else "FAIL"
            print(f"{verdict} -- {name} (#{hexval}): {n} matching samples (need >= {min_samples} to count as painted)")
        else:
            ok = not found
            verdict = "PASS" if ok else "FAIL"
            print(f"{verdict} -- {name} (#{hexval}) expected ABSENT: {n} matching samples (must be < {min_samples})")
        if not ok:
            fail = True

    if fail:
        print(f"COLOUR MEASUREMENT: FAIL (mode={mode})")
        return 1
    print(f"COLOUR MEASUREMENT: PASS (mode={mode})")
    return 0


def self_test():
    """Proves the histogram/tolerance/mode logic against a synthetic BMP-less
    in-memory Bitmap -- no `sips` round trip needed for the pure-logic half."""
    # A 10x10 solid #CD4C00 square (the real light-mode PVAccent hex) plus a
    # single stray anti-aliased edge pixel of a near-miss colour.
    rows = [[(0xCD, 0x4C, 0x00)] * 10 for _ in range(10)]
    rows[0][0] = (0xCE, 0x4D, 0x01)  # within tolerance 6, still counts
    bmp = Bitmap(10, 10, rows)
    counts = histogram(bmp, stride=1)

    ok = True
    n = sum_matches(counts, "CD4C00", tolerance=6)
    if n != 100:
        print(f"BROKEN: expected 100 matching samples (near-miss pixel within tolerance), got {n}")
        ok = False
    else:
        print(f"ok: {n} samples matched within tolerance (10x10 fill + 1 near-miss edge pixel)")

    n_absent = sum_matches(counts, "0000FF", tolerance=6)
    if n_absent != 0:
        print(f"BROKEN: expected 0 matches for an absent colour, got {n_absent}")
        ok = False
    else:
        print("ok: an absent colour matches 0 samples")

    n_strict = sum_matches(counts, "CD4C00", tolerance=0)
    if n_strict != 99:
        print(f"BROKEN: expected 99 EXACT matches (tolerance=0 excludes the 1 near-miss pixel), got {n_strict}")
        ok = False
    else:
        print(f"ok: tolerance=0 excludes the near-miss pixel ({n_strict}/100)")

    if not ok:
        print("SELF-TEST FAILED -- do not trust this script's PASS/FAIL output")
        return 1
    print("SELF-TEST PASSED")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-test":
        sys.exit(self_test())
    sys.exit(run(sys.argv[1:]))
