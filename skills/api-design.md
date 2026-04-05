# API Design

## RESTful Conventions

- Use plural nouns for resources: `/users`, `/projects`, `/tasks`.
- Map HTTP methods to operations: GET (read), POST (create), PUT (full replace), PATCH (partial update), DELETE (remove).
- Use nested routes for ownership: `/projects/{id}/tasks`.
- Return `201 Created` for successful POST, `204 No Content` for DELETE.
- Support filtering via query params: `GET /tasks?status=open&assignee=agent-3`.

## Error Response Structure

Every error response must follow this shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Human-readable summary of what went wrong.",
    "details": [
      { "field": "email", "reason": "must be a valid email address" }
    ]
  }
}
```

- `code` -- machine-readable constant (UPPER_SNAKE_CASE).
- `message` -- safe to display to end users.
- `details` -- optional array with field-level or contextual info.

## Versioning Strategy

- Use URL-path versioning: `/api/v1/resource`.
- Increment the major version only for breaking changes.
- Support the previous version for at least one release cycle before deprecation.
- Communicate deprecation via `Deprecation` and `Sunset` headers.

## Input Validation Patterns

- Validate at the boundary -- reject invalid input before it reaches business logic.
- Use allow-lists over deny-lists (accept known-good values).
- Enforce max lengths, type constraints, and format patterns (e.g., UUID, ISO 8601).
- Return all validation errors at once, not just the first one encountered.
