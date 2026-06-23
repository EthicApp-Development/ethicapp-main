# External Services Architecture

This document describes the current architecture for integrating EthicApp with
external AI services. The goal is to let a teacher enable services per design
phase, dispatch lifecycle or activity events to those services, and receive
processing results back into EthicApp.

For the adapter developer contract, including the shared AI Additions client and
Keycloak authentication flow, see:

```text
ethicapp/backend/external-services/README.md
```

## Scope

The integration currently lives in the legacy `ethicapp/` application and is
focused on teacher-authored designs and activity execution. EthicApp now owns
outbound authentication to `ethicapp-ai-additions` through a shared Keycloak
client-credentials client, so individual adapters should not negotiate tokens on
their own.

The architecture provides Bearer-token authentication for inbound callbacks
from AI Additions services through a Keycloak-issued JWT validated against the
shared realm JWKS. Durable result storage, retry queues, and a stable public
contract for third-party providers outside the repository-owned AI Additions
facade are still not implemented.

## Backend Architecture

External services are registered through a manifest:

```text
ethicapp/backend/external-services/manifest.json
```

Each manifest entry declares:

- `id`: stable external service identifier.
- `description`: teacher-facing description.
- `adapter`: ESM module path relative to the manifest.
- `hooks`: hook names supported by the service.
- `enabled`: whether the adapter should be loaded.

Hook names are standardized as kebab-case identifiers. New adapters should use
names such as `phase-started`, `phase-ended`, `session-ended`,
`chat-message-received`, `student-response-submitted`, and `callback-received`.

Adapters are ESM modules that export `register(...)`. During startup,
`externalServicesRegistry.initialize()` loads the manifest, imports each enabled
adapter, and lets it subscribe to hooks.

The current register contract is:

```js
export async function register({
  service,
  subscribe,
  publishStudentResult,
  publishGroupChatMessage,
  aiAdditionsClient
}) {
  // Subscribe to hooks here.
}
```

The `aiAdditionsClient` parameter is the only place adapters should obtain
Keycloak-protected access to AI Additions.

Current registry implementation:

```text
ethicapp/backend/services/external-services.service.js
```

Inbound callback authentication middleware:

```text
ethicapp/backend/middleware/external-services-callback-auth.middleware.js
```

Keycloak JWT validation helper:

```text
ethicapp/backend/helpers/keycloak-jwt.helper.js
```

Current mock adapter:

```text
ethicapp/backend/external-services/adapters/mock-ai-response-review.adapter.js
```

Current mock chat agent adapter:

```text
ethicapp/backend/external-services/adapters/mock-chat-agent.adapter.js
```

Current Argumentation Tutor adapter:

```text
ethicapp/backend/external-services/adapters/ats-feedback.adapter.js
```

Current Polyadic Agents bridge adapter:

```text
ethicapp/backend/external-services/adapters/polyadic-bridge.adapter.js
```

Shared AI Additions client:

```text
ethicapp/backend/services/ai-additions-client.service.js
```

## AI Additions and Keycloak

Repository-owned AI services are expected to be reached through the
`ethicapp-ai-additions` facade, not through individual service container ports.
Keycloak is exposed by that facade under the `/keycloak` prefix.

EthicApp configures the facade and Keycloak client through `AI_ADDITIONS_*`
variables. The default contract is:

- `AI_ADDITIONS_BASE_URL` points to the AI Additions facade.
- `AI_ADDITIONS_KEYCLOAK_BASE_URL` defaults to
  `${AI_ADDITIONS_BASE_URL}/keycloak`.
- `AI_ADDITIONS_KEYCLOAK_REALM` defaults to `ethicapp-ai-additions`.
- `AI_ADDITIONS_KEYCLOAK_CLIENT_ID` and
  `AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET` identify the confidential client used by
  EthicApp.
- Service-specific adapters use normalized facade paths, for example
  `/argumentation-tutor/api/v2` or `/polyadic-agent/api`.

The shared client obtains and caches client-credentials tokens, attaches Bearer
authorization headers, and retries once after a `401`. Adapter code should focus
on translating EthicApp hook context into service-specific requests.

The Polyadic Agents bridge uses `AI_ADDITIONS_POLYADIC_AGENTS_API_BASE_URL`,
defaulting to `${AI_ADDITIONS_BASE_URL}/polyadic-agent/api`, and creates one
Polyadic REST room per EthicApp session/phase/group. Its default pipeline type is
`abogado-del-diablo`, configurable through
`AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE`.

Polyadic callbacks target the unified callback endpoint:

```text
POST /external-services/callbacks
```

with `"serviceId": "polyadic-devils-advocate"` in the body. The callback payload
is expected to contain `{ "room": "...", "evaluations": [] }` in the `payload`
field.
The bridge publishes only `Orientador` responses into the EthicApp group chat;
other agent outputs remain internal to Polyadic.

The Docker Compose PoC also includes a tiny external Express service:

```text
external-mock-service/
```

EthicApp reaches it through `EXTERNAL_MOCK_SERVICE_URL`, which defaults to
`http://external-mock-service:8510` in Docker Compose. When running EthicApp
outside Compose and the mock service locally, set
`EXTERNAL_MOCK_SERVICE_URL=http://localhost:8510`. The current endpoints are:

- `POST /response-review/reverse`: receives response text and returns it reversed.
- `POST /chat-agent/respond`: receives a chat message and returns a processed
  chat-agent reply containing the processed message followed by its character
  count.

## Hook Dispatch

EthicApp dispatches hooks only to services enabled in the phase design:

```json
{
  "externalServices": {
    "enabledServiceIds": ["mock-ai-response-review"]
  }
}
```

The registry accepts `enabledServiceIds` and filters subscribers by service id.
This keeps phase and response hooks scoped to services selected by the teacher.

Current event hooks:

- `student-response-submitted`: dispatched when a student submits a supported
  response from `POST /activities/:id/response`.
- `phase-started`: dispatched when the teacher transitions a session into a phase.
- `phase-ended`: dispatched when the teacher transitions a session away from the
  previously active phase.
- `chat-message-received`: dispatched when a chat message is posted to a phase
  group chat.
- `callback-received`: dispatched when an external service calls the callback
  endpoint. Replaces the earlier `external-service-result` hook.
- `session-ended`: dispatched when a session finishes and service-local context
  should be cleaned up.

The phase transition hooks are dispatched from:

```text
ethicapp/backend/controllers/activities/activities-teacher.js
POST /activities/:session_id/phase_transition
```

The student response hook is dispatched from:

```text
ethicapp/backend/controllers/activities/activities-student.js
POST /activities/:id/response
```

The `mock-ai-response-review` adapter uses this hook to demonstrate a
student-facing result without requiring a real asynchronous provider. It sends
the submitted free-text response to the mock service, records the callback result
for inspection, and publishes an `argument-tutor-report` payload to the student
who submitted the response through `publishStudentResult(...)`.

The chat message hook is dispatched from:

```text
ethicapp/backend/controllers/group-messages.js
POST /phases/:id/question/:question_id/chat_messages
```

Chat message hook context includes:

- `sessionId`
- `phaseId`
- `questionId`
- `groupId`
- `userId`
- `parentId`
- `content`
- `savedMessage`
- `notificationPayload`
- `designType`

Groups are ephemeral in EthicApp and are scoped to a phase. Chat-oriented
adapters should therefore key any accumulated conversation state by at least
`phaseId` and `groupId`.

## External Result Callback

External AI services call the unified callback endpoint:

```text
POST /external-services/callbacks
Authorization: Bearer <access_token>
Content-Type: application/json
```

The request body identifies the target service and carries a service-specific
payload:

```json
{
  "serviceId": "polyadic-devils-advocate",
  "eventType": "result",
  "correlationId": "optional-provider-job-or-room-id",
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "payload": {
    "room": "ethicapp-s11-p22-g301",
    "evaluations": []
  }
}
```

| Field | Required | Description |
|---|---|---|
| `serviceId` | Yes | Identifier of the calling service, must match a registered service. |
| `eventType` | No | Type label for the event; defaults to `"result"`. |
| `correlationId` | No | The job UUID returned by EthicApp when the job was dispatched. Used to correlate callbacks to outbound jobs. |
| `eventId` | No | A UUID minted by the caller for this specific emission attempt. When provided, EthicApp uses `(serviceId, eventId)` as a deduplication key so that network retries of the same event are idempotent. Distinct `eventId` values on the same job are each processed independently. Omitting `eventId` falls back to terminal-state deduplication: any callback on a job that has already reached a terminal status is treated as a duplicate. |
| `payload` | No | Arbitrary service-specific data. |

The Bearer token must be a Keycloak `client_credentials` token issued to the
calling service's dedicated Keycloak client (for example `polyadic-agent-api` or
`argumentation-tutor-api`). EthicApp validates the JWT locally using the realm
JWKS, checks issuer, expiry, audience, and clock tolerance, and then authorizes
the caller against the per-service `callbackAuth` manifest entry.

The controller dispatches the `callback-received` hook with
`dispatchServiceHook(...)`, which selects only subscribers belonging to the target
service id.

Current callback controller:

```text
ethicapp/backend/controllers/external-services.js
```

The adapter is responsible for sanitizing the external payload. The registry only
routes and records the resulting callback entry for PoC inspection.

Adapters subscribe to `callback-received`:

```js
export async function register({ service, subscribe, publishStudentResult }) {
  subscribe("callback-received", async (context, { callback }) => {
    // context.serviceId, context.eventType, context.correlationId, context.eventId
    // context.requestPayload contains the caller's payload
    // context.auth contains the normalized Keycloak auth context
    await publishStudentResult({
      userId: 123,
      sessionId: 10,
      phaseId: 20,
      questionId: 30,
      component: {
        componentId: "argument-tutor-report"
      },
      payload: {
        summary: "Your argument has a clear claim and one supporting reason.",
        suggestions: ["Add evidence for the main claim."]
      }
    });
  });
}
```

The backend sends this payload to the student namespace through the
`onExternalServiceResult` websocket event. The current PoC targets a user room
named `user-{uid}`.

Adapters can publish a chat message back into EthicApp through
`publishGroupChatMessage(...)`. This helper saves the message using the same chat
tables used by `POST /phases/:id/question/:question_id/chat_messages` and emits
the same teacher/student websocket refresh notifications.

```js
export async function register({ subscribe, publishGroupChatMessage }) {
  subscribe("chat-message-received", async (context) => {
    await publishGroupChatMessage({
      sessionId: context.sessionId,
      phaseId: context.phaseId,
      questionId: context.questionId,
      groupId: context.groupId,
      parentId: context.savedMessage?.id,
      content: "Mock chat agent reply."
    });
  });
}
```

Chat-agent identity is modeled through `external_service_agents`. When an adapter
publishes a group chat message, EthicApp creates or updates the agent row using
the adapter service id and stores the chat message with `external_agent_id`.
Transcript queries then return `author_role: "external_service"` and the agent
display name, so students can distinguish agent messages from professor messages.

The `mock-chat-agent` adapter uses the external mock service to produce messages
like:

```text
dessecorp egassem (17)
```

where the text is the processed chat message and the number is its character
count. The adapter falls back to an in-process response if the external mock
service is unavailable.

## Result Inspection

Teachers and administrators can inspect durable job and callback result records
through the following endpoints. All three require an authenticated session with
the teacher (`P`) or administrator (`A`) role.

### List jobs

```text
GET /external-services/jobs
```

Returns a list of job records ordered by `created_at` descending. Supported
query parameters:

| Parameter   | Type    | Description                                      |
| ----------- | ------- | ------------------------------------------------ |
| `serviceId` | string  | Filter by external service id.                   |
| `sessionId` | integer | Filter by EthicApp session.                      |
| `phaseId`   | integer | Filter by phase.                                 |
| `status`    | string  | Filter by job status (e.g. `completed`, `failed`). |
| `from`      | ISO 8601 datetime | Lower bound on `created_at` (inclusive). |
| `to`        | ISO 8601 datetime | Upper bound on `created_at` (inclusive). |
| `limit`     | integer | Maximum number of records to return. Defaults to 50, capped at 200. |

Response shape:

```json
{
  "status": "ok",
  "result": [
    {
      "id": "<uuid>",
      "service_id": "polyadic-devils-advocate",
      "hook_name": "chat-message-received",
      "status": "completed",
      "session_id": 11,
      "phase_id": 22,
      "question_id": 701,
      "group_id": 301,
      "user_id": 9001,
      "provider_reference": null,
      "created_at": "...",
      "updated_at": "...",
      "dispatched_at": "...",
      "completed_at": "..."
    }
  ]
}
```

### Get job detail

```text
GET /external-services/jobs/:job_id
```

Returns a single job and its associated callback results. The `job_id` must be
a valid UUID.

Response shape:

```json
{
  "status": "ok",
  "result": {
    "job": { ... },
    "results": [
      {
        "id": "<uuid>",
        "correlation_id": "<uuid>",
        "service_id": "polyadic-devils-advocate",
        "hook_name": "callback-received",
        "status": "completed",
        "session_id": 11,
        "phase_id": 22,
        "question_id": 701,
        "group_id": 301,
        "user_id": null,
        "adapter_result": { ... },
        "received_at": "...",
        "processed_at": "..."
      }
    ]
  }
}
```

Raw provider payloads (`raw_payload`) are not exposed through the inspection
API. Only the adapter-processed result (`adapter_result`) is included in the
detail view.

### List callback results

```text
GET /external-services/results
```

Returns a list of callback result records ordered by `received_at` descending.
Accepts the same filters as `GET /external-services/jobs` except that `from`
and `to` apply to `received_at` rather than `created_at`.

Raw provider payloads are not included in list responses.

## Frontend Architecture

The teacher design editor loads the available services from:

```text
GET /external-services
```

Frontend service:

```text
ethicapp/frontend/assets/js/services/external-services-catalog.service.js
```

Design editor integration:

```text
ethicapp/frontend/assets/js/controllers/teacher/design-editor.controller.js
ethicapp/frontend/assets/static/views/teacher/design.edit.html
```

The editor initializes each phase with:

```json
{
  "externalServices": {
    "enabledServiceIds": []
  }
}
```

When a teacher enables a service for a phase, the service id is added to
`phase.externalServices.enabledServiceIds`. That configuration is saved as part
of the design JSON.

The student frontend listens for `onExternalServiceResult` in:

```text
ethicapp-student/frontend/src/pages/session-detail/hooks/useActivityRealtimeSync.js
```

Received results are shown by:

```text
ethicapp-student/frontend/src/components/session-detail/external-services/ExternalServiceResultPanel.jsx
```

The result descriptor supports a local component id:

```json
{
  "component": {
    "componentId": "argument-tutor-report"
  }
}
```

For experiments, it can also request a remote ESM React component:

```json
{
  "component": {
    "url": "https://example.test/argument-tutor-report.js",
    "exportName": "default"
  }
}
```

Remote component loading is intentionally experimental and should be constrained
by an allowlist or signed component bundle policy before production use.

## Design Schema

The design schema allows phase-level external service configuration:

```text
design-schema/ethicapp-v1.schema.json
```

`externalServices.enabledServiceIds` is optional and contains unique service ids.
Older designs without `externalServices` remain valid.

## Inbound Callback Authentication

EthicApp validates inbound callback Bearer tokens as a resource server against the
same Keycloak realm used for outbound authentication. The middleware reads JWKS
from the realm endpoint, caches keys for 5 minutes, and refreshes on unknown `kid`
to handle key rotation.

Authorization policy for each service is declared in `manifest.json`:

```json
{
  "id": "polyadic-devils-advocate",
  "callbackAuth": {
    "allowedClientIds": ["polyadic-agent-api"],
    "requiredRoles": []
  }
}
```

EthicApp checks that the authenticated `azp` (client id) is listed in
`allowedClientIds` and that any `requiredRoles` appear in the token's
`realm_access.roles`. A `serviceId` from the request body that does not match
an allowed client returns `403`.

Environment variables for inbound authentication:

| Variable | Purpose |
| --- | --- |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_ENABLED` | Set to `false` to disable auth in development. Defaults to `true`. |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_ISSUER` | Keycloak issuer URL. Derived from `AI_ADDITIONS_KEYCLOAK_BASE_URL` and `AI_ADDITIONS_KEYCLOAK_REALM` when unset. |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_JWKS_URL` | Explicit JWKS URL. Derived from issuer when unset. |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_AUDIENCE` | Expected `aud` claim. Defaults to `ethicapp-ai-services` (the audience injected by the Keycloak mapper in AI Additions). Leave empty to skip audience check. |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_CLOCK_TOLERANCE_SECONDS` | Clock skew tolerance. Defaults to `30`. |

## Current Limitations

- Student websocket targeting currently relies on a PoC user room joined from the
  frontend client.
- Remote React component loading is not production-hardened.
- Adapter payload sanitization is service-specific and intentionally minimal in
  the mock adapter.

## Recommended Next Steps

- Define adapter capability metadata for teacher-facing configuration beyond a
  simple enabled/disabled checkbox.
- Add integration tests for service loading, hook dispatch filtering, callback
  routing, and mismatched `serviceId` rejection.
