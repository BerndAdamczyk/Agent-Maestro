# Maestro Local Changes Feedback

Date: 2026-04-06
Scope reviewed: local Maestro-generated implementation commits and the current unpushed working-tree patch on top of `origin/main`

## What went well

- The parity work was materially useful rather than speculative. The local tasks produced concrete improvements across memory persistence, runtime policy handling, web realtime behavior, security hardening, and architecture alignment.
- The worker handoffs were generally high-signal once the recovery flow resumed them. In particular, the shared/frontend implementation notes made it much easier to understand intent and map changes back to audit findings.
- Test coverage improved in the right places: runtime policy, delegation, memory store behavior, config validation, web security, realtime UI behavior, and runtime logging now have direct regression hooks.

## Issues that needed follow-up

- Plan-gated tasks were resumed into execution without rebuilding runtime authority, which left them trapped under planning-only tool and write restrictions.
- Resume recovery failed tasks without first tearing down persisted tmux workers, which could leave an orphaned worker editing the repo in the background.
- The new `/api/memory` route hardened lexical paths but still followed symlinks, which exposed files outside the configured memory root.

## Guidance for future Maestro runs

- Whenever task phase changes alter runtime authority, rebuild both the policy manifest and the runtime tool list before resuming the agent.
- Treat persisted runtimes as live until proven otherwise. Resume recovery should terminate surviving panes or containers before changing task state.
- For any filesystem browsing endpoint, validate both lexical paths and resolved filesystem objects. Symlink handling needs to be an explicit security decision, not an accidental default.
- Keep generating finding-level implementation notes. They make review and later validation significantly faster.

## Commit hygiene note

- The local Maestro work is worth preserving, but it benefits from a final human review pass before push because several of the bugs above only became obvious when the combined patch was exercised end to end.
