# Deferred Items — Phase 8

Out-of-scope discoveries logged during execution, per the executor's scope-boundary rule (not fixed, not blocking).

## 08-03: Firefox `data_collection_permissions` build warning

**Found during:** Task 2 (`wxt build -b firefox`)

**Observed:**
```
WARN  Firefox requires data_collection_permissions for new extensions from November 3, 2025. Existing extensions are exempt for now.
For more details, see: https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
To suppress this warning, set suppressWarnings.firefoxDataCollection to true in your wxt config.
```

**Why deferred:** This is WXT/AMO policy noise unrelated to anything this plan's tasks touched — it fires for any Firefox build of this extension regardless of popup/background content. It does not fail the build and does not affect the manifest fields this plan verifies (CSP, background type, gecko.id). Addressing it (declaring `data_collection_permissions` in the manifest, one way or another) is a submission-time AMO listing concern, out of scope for a Phase 8 debug spike that is never submitted to AMO.

**Revisit:** Before any real Firefox Add-on Store submission (not covered by the current roadmap through Phase 13).
