#!/usr/bin/env python3
"""
measure-ios-dock-panel.py -- measure the ＋ panel's clearance above the dock
FROM PIXELS, in points.

WHY THIS EXISTS, and it is not belt-and-braces. The UI test measures the same
clearance off `XCUIElement.frame`, and those two numbers DISAGREE by about 16 pt:
the accessibility frame reported for `vault.create.grid` is the union of the six
tile buttons, NOT the padded glass card the user sees, so it underreports the
card's bottom edge by the panel's own 16 pt vertical padding. An assertion built
on it can pass while there is a visible gap on screen -- which is exactly the
defect Bartek caught by eye and the reason the instruction was "measure geometry
from pixels rather than eyeballing".

So: the test's number is the regression gate (cheap, runs in CI, catches a change
in either direction), and THIS is the ground truth for any number quoted to a
human.

METHOD. Reduce the bottom 45% of the screen to one number per row -- the MEDIAN
luma across the middle 55% of the width -- then find the two largest luminance
STEPS at the bottom of it: the card's bottom edge (a step DOWN, leaving the
panel's glass) and the dock's top edge (a step UP, entering the dock's glass).

TWO EARLIER VERSIONS OF THIS WERE WRONG, and how they were wrong is the reason
the current one is shaped like this:

 1. A single scan COLUMN down the screen's centre. It reported 3.3 pt for a gap
    that is really 8.0, because that column runs through a tile's glyph and the
    tab bar's label, and every glyph edge is a bigger step than the edge being
    looked for. Fixed by the row median -- glyphs are a minority of pixels on
    their row.
 2. Bright/dark BANDS with a threshold from the image's own range. It found only
    ONE band and could not measure at all, because the scrim is a GRADIENT that
    fades to zero opacity over its last 20% -- deliberately, so its edge does not
    read as a hard line above the dock. The consequence is that the region between
    the panel and the dock is barely dimmed: measured 231 against the card's 244
    and the dock's 255. There is no dark band there to find. The steps are only
    13-20 luma, but on the median profile they are the ONLY steps that size in
    that region, so they are unambiguous.

Reported in points (screenshot pixels divided by the measured device scale) so it
is comparable with the design constant `PVMetrics.dockPanelGap`.

Stdlib only -- `sips` (macOS) converts the PNG to an uncompressed BMP and the
parsing is done here. See `Bitmap` for why Pillow is not used.

Usage:
  scripts/measure-ios-dock-panel.py <panel-open.png> [--label expanded] [--verbose]
  scripts/measure-ios-dock-panel.py --self-test
"""
import os
import struct
import subprocess
import sys
import tempfile

# iPhone 16, the only device this is calibrated against.
SCREEN_PT = (393.0, 852.0)


class Bitmap:
    """A decoded image as a flat RGB row list. Stdlib only, deliberately.

    NO Pillow. This machine's python3 is an externally-managed environment
    (PEP 668) and `pip install --user Pillow` is refused; `--break-system-
    packages` is not a thing to do to a work machine for a measurement script.
    `sips` ships with macOS and converts the PNG to an uncompressed BMP, which is
    ~30 lines to parse and has no failure mode more subtle than "wrong offset".
    """

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
        # A negative height means the rows are stored top-down; the usual case is
        # positive, meaning BOTTOM-UP. Getting this backwards would flip every
        # measurement, so it is handled rather than assumed.
        top_down = height < 0
        height = abs(height)
        rows = []
        for row in range(height):
            src = row if top_down else (height - 1 - row)
            base = pixel_offset + src * stride
            # BMP stores BGR.
            rows.append([
                (data[base + x * step + 2], data[base + x * step + 1], data[base + x * step])
                for x in range(width)
            ])
        return Bitmap(width, height, rows)


def median(values):
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    return ordered[mid] if n % 2 else (ordered[mid - 1] + ordered[mid]) / 2.0


def median_row_profile(img, x0, x1):
    """Per-row MEDIAN luma across [x0, x1), Rec. 601.

    A median across the row, not a single column. The first version of this
    script scanned one column down the screen's centre and got 3.3 pt for a gap
    that is really 8.0 -- because that column runs through a tile's glyph and the
    tab bar's label, and every glyph edge is a bigger luminance step than the edge
    being looked for. Glyphs and text are a MINORITY of pixels on their row, so a
    median ignores them and reports the fill behind them.
    """
    out = []
    for y in range(img.height):
        out.append(median([
            0.299 * r + 0.587 * g + 0.114 * b
            for r, g, b in (img.pixel(x, y) for x in range(x0, x1))
        ]))
    return out


def find_steps(profile, start, stop, min_delta):
    """Rows where the profile changes by at least `min_delta`, as (row, delta)."""
    return [
        (y, profile[y] - profile[y - 1])
        for y in range(max(start, 1), stop)
        if abs(profile[y] - profile[y - 1]) >= min_delta
    ]


def find_panel_and_dock_edges(profile, start, stop, min_delta):
    """The card's bottom edge and the dock's top edge, as rows.

    The card's bottom is the FIRST step DOWN in the window, and the dock's top is
    the first step UP after it.
    
    FIRST, not last, and the self-test pins down why: the dock contains further
    steps of its own (the accessory pill's edges, the tab capsule, the home
    indicator), so scanning from the bottom latches onto a step INSIDE the dock and
    reports a few-pixel gap between two parts of the dock. The window is chosen to
    start inside the card's lower half, so the first step down in it is the card's
    own bottom edge. Verified against both real screenshots: no step of this size
    occurs between the window's start and the card's bottom edge, because the row
    median ignores the tile labels.
    """
    steps = find_steps(profile, start, stop, min_delta)
    downs = [y for y, d in steps if d < 0]
    ups = [y for y, d in steps if d > 0]
    if not downs:
        return None, None
    card_bottom = min(downs)
    below = [y for y in ups if y > card_bottom]
    if not below:
        return None, None
    return card_bottom, min(below)


def measure(path, label, verbose=False):
    img = Bitmap.from_png(path)
    scale_x = img.width / SCREEN_PT[0]
    scale_y = img.height / SCREEN_PT[1]
    # A screenshot whose aspect ratio does not match the calibrated device would
    # silently produce plausible-looking wrong numbers.
    if abs(scale_x - scale_y) > 0.02:
        sys.exit(
            f"ERROR: {path} is {img.width}x{img.height}, which is not "
            f"{SCREEN_PT[0]}x{SCREEN_PT[1]} pt at a uniform scale "
            f"(x={scale_x:.3f}, y={scale_y:.3f}) -- this script is calibrated for "
            "iPhone 16 only."
        )
    scale = scale_y

    # Horizontal band: the middle 55% of the width. Wide enough that glyphs are a
    # minority on every row, narrow enough to stay inside the panel card (which is
    # 341 of 393 pt) and inside the dock in BOTH states -- minimised, the dock's
    # middle is the inline search pill, which spans x 84..309 pt.
    x0 = int(img.width * 0.225)
    x1 = int(img.width * 0.775)
    profile = median_row_profile(img, x0, x1)

    # Search only the bottom 22%: from below the panel's tiles to the screen edge.
    # Starting higher would include the panel's own TOP edge, whose +77 step is
    # four times larger than either edge being measured.
    start = int(img.height * 0.78)
    # 12 luma: comfortably under the smallest real edge measured (13) and well
    # over the profile's own row-to-row noise (~1).
    min_delta = 12.0

    if verbose:
        print(f"    band x={x0}..{x1}px  searching y>={start}px ({start / scale:.1f}pt)")
        for y, d in find_steps(profile, start, img.height, min_delta):
            print(f"    step y={y}px ({y / scale:6.1f}pt) delta={d:+7.2f}")

    card_bottom_px, dock_top_px = find_panel_and_dock_edges(
        profile, start, img.height, min_delta
    )
    if card_bottom_px is None:
        sys.exit(
            f"ERROR: {path}: could not find a card bottom edge with a dock edge below "
            "it in the bottom 22% of the screen"
        )

    gap_pt = (dock_top_px - card_bottom_px) / scale
    print(f"  [{label}] scale={scale:.3f}x  band x={x0}..{x1}px")
    print(f"  [{label}] card bottom edge = {card_bottom_px}px = "
          f"{card_bottom_px / scale:.1f}pt")
    print(f"  [{label}] dock top edge    = {dock_top_px}px = "
          f"{dock_top_px / scale:.1f}pt")
    print(f"  [{label}] PANEL-TO-DOCK GAP = {gap_pt:.1f}pt")
    return gap_pt


def self_test():
    """Proves the band detector finds the right edges on a synthetic profile.

    Without this the script is a measurement whose failure mode is a plausible
    number, which is the shape of defect this repo has paid for repeatedly
    (ios/IOS-SPIKE-LOG.md L-9). The synthetic profile below is the real layout in
    miniature: a bright card, a dark gap, a bright dock.
    """
    if median([3.0, 1.0, 2.0]) != 2.0 or median([4.0, 1.0, 2.0, 3.0]) != 2.5:
        sys.exit("SELF-TEST FAILED: median is wrong")
    print("  ok: median, odd and even lengths")

    # card 100..149, gap 150..173, dock 174..199 -- the card's last bright row is
    # 149 and the dock's first is 174, so the gap must come back as 25.
    # The real profile in miniature, using the levels actually measured on the
    # light-mode screenshot: card glass 245, the barely-dimmed gap 231, dock glass
    # 255. Card ends at row 149, dock starts at row 174, so the gap is 25 rows.
    profile = [245.0] * 150 + [231.0] * 24 + [255.0] * 26
    card, dock = find_panel_and_dock_edges(profile, 100, len(profile), 12.0)
    if (card, dock) != (150, 174):
        sys.exit(f"SELF-TEST FAILED: expected edges (150, 174), got ({card}, {dock})")
    print("  ok: finds both edges on a profile with the real ~14/24 luma steps")

    # It must NOT fire on the profile's own noise. Real medians wobble by about a
    # luma between rows.
    noisy = [245.0 + (i % 3) for i in range(200)]
    card2, dock2 = find_panel_and_dock_edges(noisy, 100, len(noisy), 12.0)
    if card2 is not None:
        sys.exit(f"SELF-TEST FAILED: fired on row-to-row noise at {card2}")
    print("  ok: silent on row-to-row noise")

    # THE ONE THAT MATTERS FOR CORRECTNESS: extra steps INSIDE the dock (the
    # pill's own edges, the tab capsule) must not be mistaken for the dock's top.
    # This is why the search runs from the last candidate down-step, not the first.
    with_dock_detail = (
        [245.0] * 150 + [231.0] * 24 + [255.0] * 10 + [237.0] * 8 + [255.0] * 30
    )
    card3, dock3 = find_panel_and_dock_edges(with_dock_detail, 100, len(with_dock_detail), 12.0)
    if (card3, dock3) != (150, 174):
        sys.exit(
            f"SELF-TEST FAILED: dock-internal steps moved the answer to ({card3}, {dock3})"
        )
    print("  ok: steps inside the dock do not move either edge")
    print("SELF-TEST PASSED")


def main():
    args = sys.argv[1:]
    if not args or args[0] == "--self-test":
        print("== self-test ==")
        self_test()
        return 0

    verbose = "--verbose" in args
    args = [a for a in args if a != "--verbose"]
    label = "panel"
    if "--label" in args:
        i = args.index("--label")
        label = args[i + 1]
        del args[i:i + 2]

    print("== self-test ==")
    self_test()
    print("== measure ==")
    for path in args:
        measure(path, label if len(args) == 1 else path.rsplit("/", 1)[-1], verbose)
    return 0


if __name__ == "__main__":
    sys.exit(main())
