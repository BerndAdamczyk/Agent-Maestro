# Security Audit

## OWASP Top 10 Checklist

Review every component against these categories:

1. **Broken Access Control** -- Verify role checks on every endpoint; deny by default.
2. **Cryptographic Failures** -- Ensure data at rest and in transit is encrypted (TLS, AES-256).
3. **Injection** -- Use parameterized queries; never concatenate user input into commands.
4. **Insecure Design** -- Validate that threat modeling was performed during design phase.
5. **Security Misconfiguration** -- Check default credentials, open ports, verbose errors in production.
6. **Vulnerable Components** -- Audit dependencies for known CVEs; enforce automated scanning.
7. **Authentication Failures** -- Enforce strong passwords, MFA, account lockout after repeated failures.
8. **Data Integrity Failures** -- Verify signatures on updates, CI/CD pipelines, and serialized data.
9. **Logging & Monitoring Gaps** -- Ensure security events are logged and alerts are configured.
10. **SSRF** -- Validate and restrict outbound requests from server-side code.

## Input Sanitization

- Strip or escape HTML/JS in all user-supplied strings before storage and rendering.
- Validate file uploads by MIME type and content inspection, not just extension.
- Enforce strict schemas on JSON/XML payloads; reject unexpected fields.

## Authentication and Authorization Patterns

- Use short-lived JWTs (< 15 min) with refresh token rotation.
- Implement RBAC (Role-Based Access Control) with least-privilege defaults.
- Separate authentication (who are you?) from authorization (what can you do?).
- Protect all token endpoints against brute force with rate limiting.

## Secret Management

- Store secrets in a vault (e.g., HashiCorp Vault, AWS Secrets Manager) -- never in env files committed to source control.
- Rotate secrets on a defined schedule and immediately after any suspected compromise.
- Use service accounts with scoped permissions rather than shared keys.
- Audit secret access logs regularly.
