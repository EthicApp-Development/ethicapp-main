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
