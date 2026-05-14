# External Services PoC

This document describes the current proof of concept for integrating EthicApp with
external services. The goal is to let a teacher enable services per design phase,
dispatch lifecycle or activity events to those services, and receive asynchronous
processing results back into EthicApp.

## Scope

The PoC currently lives in the legacy `ethicapp/` application and is focused on
teacher-authored designs and activity execution. It does not yet provide production
authentication for external callbacks, durable result storage, retry queues, or a
stable public contract for third-party providers.

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

Adapters are ESM modules that export `register({ service, subscribe })`. During
startup, `externalServicesRegistry.initialize()` loads the manifest, imports each
enabled adapter, and lets it subscribe to hooks.

Current registry implementation:

```text
ethicapp/backend/services/external-services.service.js
```

Current mock adapter:

```text
ethicapp/backend/external-services/adapters/mock-ai-response-review.adapter.js
```

Current mock chat agent adapter:

```text
ethicapp/backend/external-services/adapters/mock-chat-agent.adapter.js
```

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
- `phaseStarted`: dispatched when the teacher transitions a session into a phase.
- `phaseEnded`: dispatched when the teacher transitions a session away from the
  previously active phase.
- `chat-message-received`: dispatched when a chat message is posted to a phase
  group chat.

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

External processing results are received through:

```text
POST /external-services/:service_id/results
```

The route-level `service_id` is the target service id. If the request body also
contains `serviceId`, it must match the route value. This convention prevents
callbacks from being broadcast promiscuously to every adapter.

Example callback body:

```json
{
  "serviceId": "mock-ai-response-review",
  "status": "completed",
  "payload": {
    "summary": "External analysis completed.",
    "score": 0.82
  },
  "message": "Processed successfully."
}
```

The controller dispatches the `external-service-result` hook with
`dispatchServiceHook(...)`, which selects only subscribers belonging to the target
service id.

Current result callback controller:

```text
ethicapp/backend/controllers/external-services.js
```

The adapter is responsible for sanitizing the external payload. The registry only
routes and records the resulting callback entry for PoC inspection.

Adapters can also publish student-facing results through the helper passed to
`register(...)`:

```js
export async function register({ service, subscribe, publishStudentResult }) {
  subscribe("external-service-result", async (context) => {
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

In-memory callback results can be inspected by teachers through:

```text
GET /external-services/results
```

The registry keeps the latest 100 result entries in memory. This is intentionally
temporary for the PoC. A production design should store results durably and link
them to sessions, phases, users, groups, questions, or service jobs as needed.

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

## Current Limitations

- Callback authentication is not production-ready. The callback endpoint is
  reachable without a legacy teacher session so external services can call it.
- There is no per-service shared secret, token, request signature, or replay
  protection yet.
- Results are stored in memory only.
- Student websocket targeting currently relies on a PoC user room joined from the
  frontend client.
- Remote React component loading is not production-hardened.
- Adapter payload sanitization is service-specific and intentionally minimal in
  the mock adapter.
- There is no job id or correlation id convention yet. Adding one would help link
  outbound hook dispatches to inbound external results.

## Recommended Next Steps

- Add a manifest-level `callbackToken` or per-service secret reference and verify
  it through an `Authorization: Bearer ...` header or HMAC signature.
- Introduce a `jobId` or `correlationId` in outbound hook payloads and require it
  in inbound results.
- Persist external results in PostgreSQL with service id, hook name, session id,
  phase id, optional user/question ids, raw payload, sanitized payload, and status.
- Define adapter capability metadata for teacher-facing configuration beyond a
  simple enabled/disabled checkbox.
- Add integration tests for service loading, hook dispatch filtering, callback
  routing, and mismatched `serviceId` rejection.
