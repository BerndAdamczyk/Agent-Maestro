# Task Decomposition

## Breaking Goals into Atomic Tasks

- Each task must have a single, verifiable outcome (one deliverable, one owner).
- If a task description contains "and", split it into two tasks.
- A task is atomic when it can be completed in one focused session (15-60 min equivalent).
- Write each task as an imperative: "Implement X", "Define Y", "Validate Z".

## Wave-Based Dependency Analysis

1. **Wave 0** -- Tasks with zero dependencies (research, setup, definitions).
2. **Wave 1** -- Tasks that depend only on Wave 0 outputs.
3. **Wave N** -- Tasks that depend on any Wave N-1 output.
- Maximize parallelism: all tasks within the same wave can execute concurrently.
- Draw the dependency graph before assigning waves; circular dependencies indicate a design flaw.

## Task Sizing and Time Budgeting

| Size  | Effort Estimate | Example                        |
|-------|-----------------|--------------------------------|
| S     | < 15 min        | Fix a typo, add a config key   |
| M     | 15-60 min       | Implement a single endpoint    |
| L     | 1-3 hours       | Design a module, write a spec  |
| XL    | > 3 hours       | Must be decomposed further     |

- Never assign an XL task -- break it down until every piece is L or smaller.
- Budget 20% buffer per wave for rework and review cycles.

## When to Create Sub-Tasks vs Single Tasks

- Create sub-tasks when a task has distinct phases (design, implement, test) owned by different agents.
- Keep it a single task when one agent can complete all phases without handoff.
- If sub-tasks exceed 5 items, re-evaluate -- you may need a separate wave instead.
