# Phase 39, Plan 39-01 -- server contract evidence

## Server identity

- Port: 8621
- Database (mktemp -d, throwaway): /var/folders/pm/7cfyh_553n554l9880l7y2rw0000gn/T//pv-ios-live.IbKDX3/pv.db
- pv-server git SHA (repo HEAD at harness start; crates/pv-server working tree is clean, confirmed by `git status --porcelain -- crates/pv-server` below): d7963b0c2ce1bd24699f449a91c9be56dd646aa5
- Binary run: /Users/j5on/.work/projects/passkey-vault-ios/target/release/pv-server

## lsof preflight (default port :8620)

```
$ lsof -nP -i :8620
(no output -- nothing was listening; harness proceeded to bind :8621 instead)
```

## crates/pv-server working-tree state at harness start

```
$ git status --porcelain -- crates/pv-server
(empty -- no local changes)
```

