---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-07-31T10:20:38.248Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 24 | deviation | crates/pv-server/src/routes/vault.rs |  | Pre-existing clippy::explicit_auto_deref warnings (18 sites, &mut *tx -> &mut tx) block whole-crate cargo clippy -p pv-server -- -D warnings; unrelated to Plan 24-02's own files, logged in phase deferred-items.md | open |  | 2026-07-31T10:20:38.248Z |  |

````json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "24",
    "file": "crates/pv-server/src/routes/vault.rs",
    "line": null,
    "description": "Pre-existing clippy::explicit_auto_deref warnings (18 sites, &mut *tx -> &mut tx) block whole-crate cargo clippy -p pv-server -- -D warnings; unrelated to Plan 24-02's own files, logged in phase deferred-items.md",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-31T10:20:38.248Z",
    "resolved_at": null
  }
]
````
