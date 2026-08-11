#!/usr/bin/env python3
"""Dump __TEXT,__entitlements of a SIMULATOR Mach-O. codesign(1) shows nothing for
simulator products: Xcode puts the entitlements in a Mach-O section, not the signature.
Exit 0 = section found and printed. Exit 2 = section absent (this is the FAIL signal).

Phase 36, Plan 36-01, Task 2 (E1). Copied verbatim from
36-RESEARCH.md's "Code Examples -> The __TEXT,__entitlements reader" (written,
and demonstrated failing, by P1) so this script does not depend on a
scratchpad surviving. Its own falsification run is recorded in
ios/AUTOFILL-FEASIBILITY.md's E1 section: `sim-entitlements.py /bin/ls`
exits 2 with the no-section message -- proof this reader is not a check
that always passes.
"""
import re, subprocess, sys
b = sys.argv[1]
out = subprocess.run(["otool","-l",b], capture_output=True, text=True).stdout
m = re.search(r"sectname __entitlements\s+segname __TEXT\s+addr\s+\S+\s+size\s+(\S+)\s+offset\s+(\d+)", out)
if not m:
    print(f"FAIL: no __TEXT,__entitlements section in {b}", file=sys.stderr); sys.exit(2)
size, off = int(m.group(1), 16), int(m.group(2))
sys.stdout.write(open(b,"rb").read()[off:off+size].decode("utf-8", "replace"))
