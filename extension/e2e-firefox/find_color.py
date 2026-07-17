#!/usr/bin/env python3
"""Find clustered regions of a target RGB color in a screenshot PNG.

Used by run-core.cjs/run-autofill-capture.cjs to locate the brand-orange
primary-action button (Fill/Use this password/Confirm) inside this
project's CLOSED shadow-root UI surfaces (Surface A/B's autofill panels,
the password-generator popover, the save/update toast) -- Firefox has no
CDP, so the Chrome Playwright harness's `DOM.getDocument({pierce:true})`
technique for reaching inside a closed shadow root has no equivalent here,
and `document.elementFromPoint()` was confirmed (13-04) to also NOT pierce
closed shadow roots on Firefox. This script finds the real, on-screen pixel
position of the primary action button via a genuine screenshot, which the
harness then clicks via selenium-webdriver's real pointer Actions API --
falsifiable, coordinate-based automation, never visual guessing.

Usage: find_color.py <path.png> <r> <g> <b> [tolerance=25] [dpr=2]
Prints one line per cluster: cx_css cy_css width_css height_css pixel_count
(coordinates already divided by dpr to CSS px, matching selenium-webdriver's
Actions API coordinate space).

Requires Pillow (`pip install Pillow`).
"""
import sys
from PIL import Image


def main():
    path = sys.argv[1]
    target = (int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
    tol = int(sys.argv[5]) if len(sys.argv) > 5 else 25
    dpr = float(sys.argv[6]) if len(sys.argv) > 6 else 2.0
    img = Image.open(path).convert("RGB")
    w, h = img.size
    px = img.load()
    pts = []
    step = 2  # sparse scan for speed
    for y in range(0, h, step):
        for x in range(0, w, step):
            r, g, b = px[x, y]
            if abs(r - target[0]) <= tol and abs(g - target[1]) <= tol and abs(b - target[2]) <= tol:
                pts.append((x, y))
    if not pts:
        print("NO_MATCH")
        return
    # Simple proximity clustering (points within 20px join the same cluster).
    pts.sort()
    clusters = []
    used = [False] * len(pts)
    for i, p in enumerate(pts):
        if used[i]:
            continue
        cluster = [p]
        used[i] = True
        changed = True
        while changed:
            changed = False
            for j, q in enumerate(pts):
                if used[j]:
                    continue
                for cp in cluster:
                    if abs(cp[0] - q[0]) <= 20 and abs(cp[1] - q[1]) <= 20:
                        cluster.append(q)
                        used[j] = True
                        changed = True
                        break
        clusters.append(cluster)
    for c in clusters:
        xs = [p[0] for p in c]
        ys = [p[1] for p in c]
        cx = sum(xs) / len(xs)
        cy = sum(ys) / len(ys)
        width = max(xs) - min(xs)
        height = max(ys) - min(ys)
        print(f"{cx/dpr:.1f} {cy/dpr:.1f} {width/dpr:.1f} {height/dpr:.1f} {len(c)}")


if __name__ == "__main__":
    main()
