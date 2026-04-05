# Code Review

## What to Check

- **Correctness** -- Does the code do what the task specification requires?
- **Readability** -- Can another developer understand it without extra explanation?
- **Naming** -- Are variables, functions, and files named clearly and consistently?
- **Test coverage** -- Are new code paths covered by tests? Are edge cases handled?
- **Documentation** -- Are public interfaces, non-obvious logic, and config options documented?

## Common Anti-Patterns

- God objects or functions that do too many things (> 30 lines is a smell).
- Deep nesting (> 3 levels) -- refactor to early returns or extracted helpers.
- Hardcoded values that should be configuration or constants.
- Swallowed exceptions with empty catch blocks.
- Copy-pasted code blocks -- extract shared logic instead.

## Performance Considerations

- Watch for N+1 query patterns in data access layers.
- Avoid unnecessary allocations inside loops.
- Check that pagination is enforced on list endpoints (no unbounded queries).
- Verify caching headers and strategies where applicable.
- Flag synchronous blocking calls in async code paths.

## Security Checklist Items

- No secrets, tokens, or credentials in source code.
- User input is sanitized before database queries and template rendering.
- Authorization checks are present on every state-changing operation.
- Logging does not emit PII or sensitive data.
- Dependencies are pinned and free of known vulnerabilities.
