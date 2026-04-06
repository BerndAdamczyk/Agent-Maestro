---
domain: "engineering"
owner: "Engineering Lead"
updated: 2026-04-06
schema_version: 1
---

## Coding Standards

## Architecture Patterns

- **- **package.json**: Added `"type-check": "tsc --noEmit"` script entry. The `type-check` script was missing from package.json while the reconciliation step expected it. The project already had an identical `lint` script (`tsc --noEmit`), so `type-check` was added as an explicit alias.** (confidence: 0.76)
  _Source: task-reconcile-1-1, 2026-04-06_

## Proven Heuristics
