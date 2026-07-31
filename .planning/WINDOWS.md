---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 0
total_count: 2
last_updated: 2026-07-31T11:46:48.811Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 24 | deviation | crates/pv-server/src/routes/vault.rs |  | Pre-existing clippy::explicit_auto_deref warnings (18 sites, &mut *tx -> &mut tx) block whole-crate cargo clippy -p pv-server -- -D warnings; unrelated to Plan 24-02's own files, logged in phase deferred-items.md | open |  | 2026-07-31T10:20:38.248Z |  |
| 2 | 24 | stub | web/src/components/settings/FamilyTab.tsx |  | Collection-scope invite ('Family + one folder') sourced from useFolders(); no client-side collections create/list/decrypt capability exists, so generating a folder-scoped invite fails via the existing invite.generateFailed error path (fails loud, never silently) until a future phase builds real collection authoring. | open |  | 2026-07-31T11:46:48.811Z |  |

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
  },
  {
    "id": 2,
    "kind": "stub",
    "phase": "24",
    "file": "web/src/components/settings/FamilyTab.tsx",
    "line": null,
    "description": "Collection-scope invite ('Family + one folder') sourced from useFolders(); no client-side collections create/list/decrypt capability exists, so generating a folder-scoped invite fails via the existing invite.generateFailed error path (fails loud, never silently) until a future phase builds real collection authoring.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-31T11:46:48.811Z",
    "resolved_at": null
  }
]
````
