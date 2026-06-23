# External Services

This directory contains EthicApp backend adapters for optional external AI services.
Adapters are loaded through `manifest.json` and are executed by the external services
registry in `../services/external-services.service.js`.

The current production-oriented contract is that EthicApp owns authentication to
`ethicapp-ai-additions`. Individual adapters should call AI services through the
shared AI Additions client instead of negotiating Keycloak tokens themselves.

## Runtime Model

At startup, the registry reads `manifest.json` from this directory, or the path
configured through `EXTERNAL_SERVICES_MANIFEST`.

Each enabled manifest entry must include:

```json
{
  "id": "argumentation-tutor-system",
  "description": "Human-readable description.",
  "adapter": "./adapters/ats-feedback.adapter.js",
  "hooks": ["student-response-submitted", "callback-received"],
  "enabled": true,
  "callbackAuth": {
    "allowedClientIds": ["argumentation-tutor-api"],
    "requiredRoles": []
  }
}
```

`callbackAuth` is optional. When present, EthicApp verifies that the authenticated
Keycloak `azp` claim is in `allowedClientIds` and that any `requiredRoles` appear
in the token's `realm_access.roles` before dispatching `callback-received`.

For each enabled service, the registry imports the adapter and calls its exported
`register()` function:

```js
export async function register({
    service,
    subscribe,
    publishStudentResult,
    publishGroupChatMessage,
    aiAdditionsClient,
}) {
    subscribe("student-response-submitted", async (context, { callback }) => {
        // Adapter logic.
    });
}
```

The adapter should subscribe only to hooks it handles. The registry records
callback results in memory for operational visibility and injects the current
`serviceId` into hook contexts.

Hook names are part of the adapter interface and must use kebab-case, for
example `phase-started`, `phase-ended`, `activity-started`, `activity-finished`,
`student-response-submitted`, and `callback-received`.

## Available Hook Publishers

The registry provides two helper publishers to adapters:

- `publishStudentResult(payload)`: sends a socket notification to a student.
  The payload must include a valid `userId`.
- `publishGroupChatMessage(payload)`: saves a message authored by the external
  service and publishes chat notifications. The payload must include `content`,
  `phaseId`, `questionId`, and `groupId`; `sessionId`, `parentId`, and
  `agentDisplayName` are optional but should be provided when available.

Hook names are part of the adapter interface and must use kebab-case, for
example `phase-started`, `phase-ended`, `activity-started`, `activity-finished`,
`student-response-submitted`, and `callback-received`.

Adapters can also call the `callback(result)` function passed to a subscribed
hook handler. This is for recording adapter outcomes, not for communicating with
AI Additions.

## AI Additions Authentication

EthicApp authenticates to AI Additions centrally through
`../services/ai-additions-client.service.js`.

The client uses the Keycloak client credentials flow and:

- derives the token endpoint from the AI Additions facade by default;
- caches access tokens until shortly before expiry;
- coalesces concurrent token requests;
- adds the `Authorization: Bearer ...` header to authenticated requests;
- retries once after `401` by clearing the cached token.

Adapters must not implement Keycloak token negotiation directly. Use the injected
`aiAdditionsClient`:

```js
const response = await aiAdditionsClient.requestJson("/sessions", {
    method: "POST",
    baseUrl: process.env.AI_ADDITIONS_MY_SERVICE_API_BASE_URL
        || aiAdditionsClient.buildServiceUrl("/my-service/api/v1"),
    body: {
        example: true,
    },
});
```

Set `authenticated: false` only for explicitly public AI Additions endpoints.

## Environment Variables

### Outbound authentication (EthicApp → AI Additions)

| Variable | Purpose |
| --- | --- |
| `AI_ADDITIONS_BASE_URL` | Base URL for the AI Additions facade. Defaults to `http://host.docker.internal:8010`. |
| `AI_ADDITIONS_HTTP_TIMEOUT_MS` | HTTP timeout for token and service requests. Defaults to `12000`. |
| `AI_ADDITIONS_KEYCLOAK_BASE_URL` | Keycloak base URL. Defaults to `${AI_ADDITIONS_BASE_URL}/keycloak`. |
| `AI_ADDITIONS_KEYCLOAK_REALM` | Keycloak realm. Defaults to `ethicapp-ai-additions`. |
| `AI_ADDITIONS_KEYCLOAK_CLIENT_ID` | Confidential client id used by EthicApp. Required for authenticated calls. |
| `AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET` | Confidential client secret used by EthicApp. Required for authenticated calls. |
| `AI_ADDITIONS_KEYCLOAK_TOKEN_URL` | Optional full token endpoint override. |
| `AI_ADDITIONS_KEYCLOAK_SCOPE` | Optional token scope. |

### Inbound callback authentication (AI Additions → EthicApp)

| Variable | Purpose |
| --- | --- |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_ENABLED` | Set to `false` to disable JWT validation in development. Defaults to `true`. |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_ISSUER` | Keycloak issuer URL for JWT `iss` claim validation. Derived from `AI_ADDITIONS_KEYCLOAK_BASE_URL` and `AI_ADDITIONS_KEYCLOAK_REALM` when unset. |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_JWKS_URL` | Explicit JWKS endpoint. Derived from issuer as `.../protocol/openid-connect/certs` when unset. |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_AUDIENCE` | Expected `aud` claim. Defaults to `ethicapp-ai-services` (the audience injected by the Keycloak mapper in AI Additions). Leave empty to skip audience check. |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_CLOCK_TOLERANCE_SECONDS` | Clock skew tolerance for `exp`/`nbf` validation. Defaults to `30`. |

Service-specific adapters may define additional variables for their normalized
facade path. For example, the Argumentation Tutor adapter uses:

| Variable | Purpose |
| --- | --- |
| `AI_ADDITIONS_ARGUMENTATION_TUTOR_API_BASE_URL` | Argumentation Tutor API base URL. Defaults to `${AI_ADDITIONS_BASE_URL}/argumentation-tutor/api/v2`. |
| `AI_ADDITIONS_ARGUMENTATION_TUTOR_POLL_INTERVAL_MS` | Poll interval for asynchronous tutor jobs. |
| `AI_ADDITIONS_ARGUMENTATION_TUTOR_POLL_TIMEOUT_MS` | Maximum poll duration for asynchronous tutor jobs. |

When adding, removing, or renaming variables, update the repository deployment
contract in `../../../deploy/env.contract.yml` and the relevant `.env.example`
files.

## AI Additions Facade Contract

EthicApp should call AI Additions through the facade URL, not through internal
container ports. In a co-located staging deployment, AI Additions can listen only
on localhost while EthicApp remains public. In that topology:

- `AI_ADDITIONS_BASE_URL` should point to the local AI Additions facade, for
  example `http://127.0.0.1:8010`.
- Keycloak should be reached through the facade prefix,
  `http://127.0.0.1:8010/keycloak`.
- Service APIs should use normalized facade paths such as
  `/argumentation-tutor/api/v2` or `/polyadic-agent/api`.

AI Additions services validate the Bearer token issued by the shared realm.
EthicApp adapters only need to use the shared client; authentication remains
transparent to adapter business logic.

## Correlation ID Propagation

Each hook invocation creates a job in `external_service_jobs` and injects a
`correlationId` (equal to the job UUID) into the handler context.  Adapters
should forward this value in outbound AI Additions requests so that the
provider can echo it back in its callback payload.  EthicApp then matches the
inbound callback to the original job via that field.

### Polyadic bridge

Only outbound **message forwarding** (`POST /rooms/{room}/messages`) includes
`ethicapp_correlation_id`. Session creation (`POST /rooms/{room}/sessions`)
does **not** carry it, because session creation is a fan-out operation
(one per team) that does not map to a single future callback — sending the
same `phase-started` job UUID to all rooms would cause all but the first
evaluation callback to be treated as duplicates under the idempotency logic
introduced in #584.

```json
{ "username": "...", "content": "...", "ethicapp_correlation_id": "<correlationId>" }
```

The Polyadic AI Additions service should track the most recent
`ethicapp_correlation_id` received per room and include it in EthicApp
callbacks as `correlationId`:

```json
{
  "serviceId":     "polyadic-devils-advocate",
  "eventType":     "result",
  "correlationId": "<most-recent ethicapp_correlation_id for the room>",
  "payload": {
    "room":        "ethicapp-s<N>-p<N>-g<N>",
    "evaluations": [ ... ]
  }
}
```

This ensures each evaluation callback correlates to the `chat-message-received`
job that last forwarded a message to the room, not to the `phase-started` job.

See `send_ethicapp_callback` in
`ethicapp-ai-additions/polyadic-agents/backend/app/agentComponents/mediators/base_mediator.py`
for the changes required on the provider side.

### Argumentation Tutor System

Argument submissions (`POST /sessions/{id}/arguments` and
`POST /sessions/{id}/arguments/compare`) include `correlationId` inside
`client_context`:

```json
{
  "client_context": {
    "service": "ethicapp",
    "correlationId": "<correlationId>",
    "sessionId": ...,
    "phaseId": ...,
    "questionId": ...,
    "groupId": ...
  }
}
```

ATS already stores and returns `client_context` in the task status response,
so the correlation ID is preserved for audit without further changes to the
ATS provider.

## Adapter Guidelines

When implementing a new adapter:

1. Add the adapter module under `adapters/`.
2. Export `register()` and subscribe to the hooks the service needs.
3. Add a service entry to `manifest.json`, including `callbackAuth` if the
   service posts inbound callbacks.
4. Use `aiAdditionsClient.requestJson()` for AI Additions HTTP calls.
5. Keep service-specific URL configuration under an `AI_ADDITIONS_<SERVICE>_*`
   prefix.
6. Subscribe to `callback-received` to handle inbound callbacks from the service.
7. Publish outcomes through `publishStudentResult`,
   `publishGroupChatMessage`, or the hook `callback()` as appropriate.
8. Add focused backend tests for reusable logic or authentication-sensitive
   behavior.

Avoid putting secrets or Keycloak client-credentials logic inside adapters. The
adapter boundary should stay focused on translating EthicApp hook context into
service-specific AI Additions requests and translating service responses back
into EthicApp notifications or callback records.
