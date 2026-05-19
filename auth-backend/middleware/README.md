# Auth backend middleware

## CSRF protection

`csrfProtection.js` protects browser-initiated mutating requests by requiring a
session-bound token in `X-CSRF-Token`. The token is issued by
`GET /api/auth/csrf-token` and stored in the Express session.

CSRF applies to browser requests that automatically carry cookies. Internal
server-to-server requests should not use browser CSRF tokens. Instead,
`management-console` authenticates its internal calls to `auth-backend` with
`X-Internal-Service-Token`, and this service validates it against
`AUTH_INTERNAL_SERVICE_TOKEN`.

Production deployments must set the same `AUTH_INTERNAL_SERVICE_TOKEN` value in
both `auth-backend` and `management-console`. The development fallback exists
only to keep local Docker Compose usable when the variable is not set.
