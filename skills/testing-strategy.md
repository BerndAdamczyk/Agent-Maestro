# Testing Strategy

## Unit vs Integration vs E2E Testing

| Level        | Scope                        | Speed  | When to Use                              |
|--------------|------------------------------|--------|------------------------------------------|
| Unit         | Single function or class     | Fast   | Pure logic, algorithms, transformations  |
| Integration  | Multiple components together | Medium | API routes, DB queries, service calls    |
| E2E          | Full user workflow           | Slow   | Critical paths, smoke tests, deployments |

- Follow the test pyramid: many unit tests, fewer integration tests, minimal E2E tests.
- Unit tests must have no external dependencies (mock I/O, DB, network).
- Integration tests use real dependencies (test database, local services).

## Test Coverage Thresholds

- **Minimum overall coverage:** 80% line coverage.
- **Critical modules** (auth, payments, data access): 90%+ branch coverage.
- **New code:** every PR must maintain or increase coverage -- never decrease it.
- Coverage alone is not quality; review that tests assert meaningful outcomes, not just execution.

## Edge Case Identification

Systematically test these categories for every function:

- **Empty inputs** -- null, undefined, empty string, empty array.
- **Boundary values** -- 0, 1, max int, max string length.
- **Invalid types** -- wrong data type, malformed JSON, unexpected encoding.
- **Concurrent access** -- race conditions, duplicate submissions.
- **Failure modes** -- network timeout, disk full, permission denied.

## Regression Test Priorities

- Every bug fix must include a regression test that reproduces the original failure.
- Tag regression tests so they can be run as a dedicated suite.
- Prioritize regression tests for areas with historical instability.
- Run the full regression suite before every release; run a focused subset on every PR.
