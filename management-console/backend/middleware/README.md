# Management console middleware

## CSRF protection

`csrfProtection.js` protects browser-initiated mutating requests under
`/mng/api` by requiring a session-bound token in `X-CSRF-Token`. The token is
issued by `GET /mng/api/csrf-token` and stored in the Express session.

CSRF applies to browser requests that automatically carry cookies. Internal
server-to-server calls from `management-console` to `auth-backend` use explicit
service authentication instead: `authBackend.service.js` sends
`X-Internal-Service-Token`, and `auth-backend` validates it against
`AUTH_INTERNAL_SERVICE_TOKEN`.

Production deployments must set the same `AUTH_INTERNAL_SERVICE_TOKEN` value in
both `auth-backend` and `management-console`. The development fallback exists
only to keep local Docker Compose usable when the variable is not set.
