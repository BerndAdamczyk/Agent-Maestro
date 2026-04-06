---
agent: engineering-lead
updated: 2026-04-06
schema_version: 1
---

## Preferences

## Patterns Learned

- **- Kept the new script consistent with the existing `lint` script that performs the same `tsc --noEmit` operation.** (confidence: 0.82)
  _Source: task-reconcile-1-1, 2026-04-06_

## Strengths

## Mistakes to Avoid

- **- There are now two scripts (`lint` and `type-check`) that do the exact same thing. Consider consolidating or having one delegate to the other (e.g., `"lint": "npm run type-check"`) to avoid drift.** (confidence: 0.78)
  _Source: task-reconcile-1-1, 2026-04-06_

## Collaborations

- **- Standardise on a single script name for type-checking across the project's CI and reconciliation commands.** (confidence: 0.72)
  _Source: task-reconcile-1-1, 2026-04-06_
