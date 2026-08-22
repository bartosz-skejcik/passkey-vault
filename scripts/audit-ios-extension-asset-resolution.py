#!/usr/bin/env python3
"""
audit-ios-extension-asset-resolution.py -- mechanically proves every asset name
(colour/image) referenced from a target's own compiled Swift code resolves in a
catalog THAT TARGET ACTUALLY SHIPS -- not merely that the name exists SOMEWHERE in
the project.

WHY THIS EXISTS (`.planning/debug/passkey-reg-blank-sheet-discord.md`, 2026-08-22).
`scripts/audit-ios-colour-tokens.sh`'s own check 2 answers "does code REFERENCE a
real colorset" -- it has no concept of TARGET membership, so it is blind to exactly
the defect that shipped: `PasskeyRegistrationConfirmView.swift` (compiled into the
`PasskeyVaultAutoFill` app-extension target) referenced six real `PV*` colorsets
that existed on disk, in `Assets.xcassets` -- but that catalog was never a member
of the EXTENSION target's own `fileSystemSynchronizedGroups` (Xcode 16's
synchronized-folder-group project format; see this file's `_resolve_target_dirs`).
An app extension's own main bundle is its `.appex`, not the host app's `.app` --
asset-catalog name lookups against a name absent from the CURRENT target's own
compiled catalog silently degrade (no crash, no exception, no build warning) rather
than fail loud, so this defect shipped invisibly through a code-level audit, a live
XCUITest suite (identifier-based, blind to whether anything was actually painted --
see `scripts/measure-ios-color-token.py`'s own header), and two rounds of manual
review.

METHOD, entirely static -- no build, no simulator:
  1. Parse `project.pbxproj` (Xcode 16 `PBXFileSystemSynchronizedRootGroup` format,
     `objectVersion = 77`) to find the named target's own `fileSystemSynchronizedGroups`
     -- the literal list of on-disk folders Xcode compiles into that target.
  2. Resolve each folder to an absolute path, honouring `PBXFileSystemSynchronizedBuildFileExceptionSet.membershipExceptions`
     (files/subpaths explicitly EXCLUDED from that target despite living under a
     synced folder -- e.g. `PasskeyVaultAutoFill/Info.plist` is excluded because it
     is consumed as the literal `INFOPLIST_FILE`, not copied as a resource).
  3. Within those folders: find every `.xcassets` catalog and enumerate its
     `.colorset`/`.imageset`/`.symbolset`/`.appiconset` entries -- the set of names
     THIS TARGET can actually resolve.
  4. Within the SAME folders: grep every `.swift` file for `Color("NAME")`,
     `UIColor(named: "NAME")`, and `Image("NAME")` -- the set of names THIS
     TARGET's own code asks the asset catalog to resolve. (Deliberately does NOT
     match `Image(systemName: "...")` -- an SF Symbol lookup, not a catalog asset.)
  5. Any referenced name absent from the resolvable set is a genuine, structural
     defect of exactly this shape -- reported by name and file:line, never silently
     dropped.

This is a MECHANICAL, textual check against the exact Xcode 16 synchronized-group
project shape this project uses today -- not a general pbxproj parser. If a future
Xcode format change alters this shape, this script's own `_resolve_target_dirs`
is where that update belongs (kept in one place, like `gen-ios-colorsets.py`'s own
single `ASSETS` constant).

Usage:
  scripts/audit-ios-extension-asset-resolution.py [--target NAME] [--pbxproj PATH] [--project-dir PATH]
  scripts/audit-ios-extension-asset-resolution.py --self-test

Exit 0 and "PASS" when every referenced name resolves; exit 1 and "FAIL" (listing
every unresolved name) otherwise.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PBXPROJ = os.path.join(ROOT, "ios", "PasskeyVault", "PasskeyVault.xcodeproj", "project.pbxproj")
DEFAULT_PROJECT_DIR = os.path.join(ROOT, "ios", "PasskeyVault")
DEFAULT_TARGET = "PasskeyVaultAutoFill"

ASSET_EXTS = (".colorset", ".imageset", ".symbolset", ".appiconset")

COLOR_REF_RE = re.compile(r'Color\("([A-Za-z0-9_]+)"\)')
UICOLOR_REF_RE = re.compile(r'UIColor\(named:\s*"([A-Za-z0-9_]+)"\)')
IMAGE_REF_RE = re.compile(r'Image\("([A-Za-z0-9_]+)"\)')


def _extract_object_block(pbxproj_text, object_id):
    """Returns the body text of the top-level object with this ID (Xcode's
    consistent 2-tab-indent `ID /* comment */ = { ... };` shape)."""
    pattern = re.compile(
        r"\t\t" + re.escape(object_id) + r" /\* .*? \*/ = \{(.*?)\n\t\t\};",
        re.DOTALL,
    )
    m = pattern.search(pbxproj_text)
    if not m:
        raise ValueError(f"object {object_id} not found in pbxproj (or not a top-level object block)")
    return m.group(1)


def _find_native_target_block(pbxproj_text, target_name):
    pattern = re.compile(
        r"/\* " + re.escape(target_name) + r" \*/ = \{\s*\n\t\t\tisa = PBXNativeTarget;(.*?)\n\t\t\};",
        re.DOTALL,
    )
    m = pattern.search(pbxproj_text)
    if not m:
        raise ValueError(f"PBXNativeTarget '{target_name}' not found in pbxproj")
    return m.group(1)


def _parse_id_list(block, key):
    """Parses `key = (\n\t\t\t\tID /* comment */,\n\t\t\t\t...\n\t\t\t);` -> [ID, ...]."""
    m = re.search(re.escape(key) + r"\s*=\s*\((.*?)\);", block, re.DOTALL)
    if not m:
        return []
    ids = re.findall(r"([0-9A-Fa-f]{24,32})\s*(?:/\*.*?\*/)?\s*,", m.group(1))
    return ids


def _resolve_root_group_path(pbxproj_text, group_id):
    body = _extract_object_block(pbxproj_text, group_id)
    m = re.search(r'path = ("(?:[^"]*)"|[^;]+);', body)
    if not m:
        raise ValueError(f"PBXFileSystemSynchronizedRootGroup {group_id} has no path")
    raw = m.group(1).strip()
    if raw.startswith('"') and raw.endswith('"'):
        raw = raw[1:-1]
    return raw


def _find_exceptions_for_target(pbxproj_text, target_name):
    """Returns {exception_set_id: [membershipExceptions...]} for exception sets
    whose own `target = <ID> /* <target_name> */;` names this target."""
    result = {}
    for m in re.finditer(
        r"\t\t([0-9A-Fa-f]{24,32}) /\* .*? \*/ = \{\s*\n\t\t\tisa = PBXFileSystemSynchronizedBuildFileExceptionSet;(.*?)\n\t\t\};",
        pbxproj_text, re.DOTALL,
    ):
        exc_id, body = m.group(1), m.group(2)
        if f"/* {target_name} */" not in re.search(r"target = .*?;", body, re.DOTALL).group(0):
            continue
        mem = re.search(r"membershipExceptions\s*=\s*\((.*?)\);", body, re.DOTALL)
        entries = []
        if mem:
            for line in mem.group(1).splitlines():
                line = line.strip().rstrip(",").strip()
                if not line:
                    continue
                if line.startswith('"') and line.endswith('"'):
                    line = line[1:-1]
                entries.append(line)
        result[exc_id] = entries
    return result


def resolve_target_dirs(pbxproj_text, project_dir, target_name):
    """Returns [(abs_dir_path, [excluded relative-path fragments])] for every
    fileSystemSynchronizedGroups member of the named target."""
    target_block = _find_native_target_block(pbxproj_text, target_name)
    group_ids = _parse_id_list(target_block, "fileSystemSynchronizedGroups")
    if not group_ids:
        raise ValueError(
            f"target '{target_name}' has no fileSystemSynchronizedGroups -- either it "
            "uses the OLDER PBXGroup/PBXFileReference project format (this script does "
            "not support that shape) or genuinely has no synced folders"
        )

    # Exceptions are declared PER exception-set, each pointed at a specific root
    # group by the group's own `exceptions = (...)` list -- gather target-scoped
    # exception sets, then intersect with each resolved group.
    target_exception_ids = set()
    for exc_id, _entries in _find_exceptions_for_target(pbxproj_text, target_name).items():
        target_exception_ids.add(exc_id)

    dirs = []
    for gid in group_ids:
        rel_path = _resolve_root_group_path(pbxproj_text, gid)
        abs_path = os.path.normpath(os.path.join(project_dir, rel_path))
        group_body = _extract_object_block(pbxproj_text, gid)
        group_exc_ids = _parse_id_list(group_body, "exceptions")
        excluded = []
        for eid in group_exc_ids:
            if eid in target_exception_ids:
                excluded.extend(_find_exceptions_for_target(pbxproj_text, target_name)[eid])
        dirs.append((abs_path, excluded))
    return dirs


def collect_available_assets(target_dirs):
    """{asset_name: [catalog paths it was found in]}"""
    available = {}
    for abs_dir, excluded in target_dirs:
        if not os.path.isdir(abs_dir):
            continue
        for dirpath, dirnames, _filenames in os.walk(abs_dir):
            for d in list(dirnames):
                for ext in ASSET_EXTS:
                    if d.endswith(ext):
                        name = d[: -len(ext)]
                        full = os.path.join(dirpath, d)
                        rel = os.path.relpath(full, abs_dir)
                        if any(rel == exc or rel.startswith(exc.rstrip("/") + "/") for exc in excluded):
                            continue
                        available.setdefault(name, []).append(full)
    return available


def collect_referenced_assets(target_dirs):
    """{asset_name: [(file, lineno), ...]}"""
    referenced = {}
    for abs_dir, excluded in target_dirs:
        if not os.path.isdir(abs_dir):
            continue
        for dirpath, _dirnames, filenames in os.walk(abs_dir):
            for fn in filenames:
                if not fn.endswith(".swift"):
                    continue
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, abs_dir)
                if any(rel == exc for exc in excluded):
                    continue
                with open(full, encoding="utf-8", errors="replace") as f:
                    for lineno, line in enumerate(f, start=1):
                        for pattern in (COLOR_REF_RE, UICOLOR_REF_RE, IMAGE_REF_RE):
                            for match in pattern.finditer(line):
                                referenced.setdefault(match.group(1), []).append((full, lineno))
    return referenced


def audit(target_name, pbxproj_path, project_dir):
    with open(pbxproj_path, encoding="utf-8") as f:
        pbxproj_text = f.read()

    target_dirs = resolve_target_dirs(pbxproj_text, project_dir, target_name)
    dir_list = ", ".join(os.path.relpath(d, ROOT) for d, _ in target_dirs)
    print(f"== target '{target_name}': synced folders = [{dir_list}] ==")

    available = collect_available_assets(target_dirs)
    referenced = collect_referenced_assets(target_dirs)

    if not referenced:
        print(f"PASS -- '{target_name}' compiles no Swift code that references a named asset catalog entry")
        return 0

    unresolved = {name: sites for name, sites in referenced.items() if name not in available}

    print(f"-- {len(referenced)} distinct asset name(s) referenced, {len(available)} distinct name(s) resolvable in this target's own synced catalogs")
    if unresolved:
        print(f"FAIL -- {len(unresolved)} asset name(s) referenced by '{target_name}' code do NOT resolve in any catalog this target ships:")
        for name, sites in sorted(unresolved.items()):
            locs = ", ".join(f"{os.path.relpath(f, ROOT)}:{n}" for f, n in sites)
            print(f"  - {name}  (referenced at {locs})")
        return 1

    print(f"PASS -- every referenced asset name resolves in a catalog '{target_name}' actually ships")
    return 0


def self_test():
    """Proves the regexes fire on real reference shapes and do NOT fire on the
    SF-Symbol shape they must not be confused with -- run against in-memory
    strings, no project/pbxproj I/O."""
    ok = True

    cases_should_match = [
        ('Color("PVAccent")', COLOR_REF_RE, "PVAccent"),
        ('UIColor(named: "PVBackground")', UICOLOR_REF_RE, "PVBackground"),
        ('Image("OnboardingAppIcon")', IMAGE_REF_RE, "OnboardingAppIcon"),
    ]
    for text, pattern, expected in cases_should_match:
        m = pattern.search(text)
        if not m or m.group(1) != expected:
            print(f"BROKEN: pattern did not match {text!r} -> {expected!r}")
            ok = False
        else:
            print(f"ok: matched {text!r} -> {expected!r}")

    # The negative case that matters most: an SF Symbol lookup must never be
    # mistaken for a catalog asset reference.
    sf_symbol_text = 'Image(systemName: "key.fill")'
    if IMAGE_REF_RE.search(sf_symbol_text):
        print(f"BROKEN: Image(systemName:) false-positived as a catalog asset reference: {sf_symbol_text!r}")
        ok = False
    else:
        print(f"ok: {sf_symbol_text!r} correctly NOT treated as a catalog asset reference")

    if not ok:
        print("SELF-TEST FAILED -- do not trust this script's PASS/FAIL output")
        return 1
    print("SELF-TEST PASSED")
    return 0


def main(argv):
    if argv and argv[0] == "--self-test":
        return self_test()

    target = DEFAULT_TARGET
    pbxproj_path = DEFAULT_PBXPROJ
    project_dir = DEFAULT_PROJECT_DIR

    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--target":
            target = argv[i + 1]
            i += 2
        elif arg == "--pbxproj":
            pbxproj_path = argv[i + 1]
            i += 2
        elif arg == "--project-dir":
            project_dir = argv[i + 1]
            i += 2
        else:
            print(f"ERROR: unknown argument '{arg}'", file=sys.stderr)
            return 1

    return audit(target, pbxproj_path, project_dir)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
