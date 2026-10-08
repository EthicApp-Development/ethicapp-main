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

### Manifest entries

Each manifest entry describes one service:

```json
{
  "id": "argumentation-tutor-system",
  "description": "Human-readable description.",
  "adapter": "./adapters/ats-feedback.adapter.js",
  "hooks": ["student-response-submitted", "phase-ended", "callback-received"],
  "globalHooks": [],
  "capabilities": {
    "processesStudentResponses": true
  },
  "enabled": true,
  "callbackAuth": {
    "allowedClientIds": ["argumentation-tutor-api"],
    "requiredRoles": []
  }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Service identifier. Used as `serviceId` everywhere (jobs, callbacks, chat agent identity, design-level enablement). |
| `adapter` | yes | Module path resolved relative to the manifest file. |
| `description` | no | Defaults to an empty string. |
| `hooks` | no | Declarative list of the hooks the adapter subscribes to. Non-kebab-case names are dropped with a warning. The registry does not enforce that `subscribe()` calls match this list; it is exposed through `GET /external-services` for operators and the teacher UI, so keep it in sync with the adapter. |
| `globalHooks` | no | Hooks the service opts into at manifest level, without an activity-design opt-in. Defaults to `[]`. Each name must be kebab-case and must also appear in `hooks`; other entries are dropped with a warning and duplicates are removed. Only consulted by `dispatchGlobalHook()` (see "Hook enablement"). Exposed through `GET /external-services`. |
| `capabilities` | no | Normalized to `{ processesStudentResponses: boolean }`; any other key is discarded. Exposed through `GET /external-services`. |
| `enabled` | no | Defaults to `true`. Disabled services stay listed but their adapter is never imported. |
| `callbackAuth` | no | Inbound callback authorization. See below. |

When `callbackAuth` is present, EthicApp verifies that the authenticated Keycloak
`azp` claim is in `allowedClientIds` and that any `requiredRoles` appear in the
token's `realm_access.roles` before dispatching `callback-received`.

### Adapter registration

For each enabled service, the registry imports the adapter module and calls its
`register()` function once at startup. The function must be a named export
(`export async function register(...)`); a `default.register` property is also
accepted as a fallback. Modules without a callable `register` are skipped with a
warning and never receive hooks.

```js
export async function register({
    service,                 // normalized manifest entry (id, description, hooks, globalHooks, capabilities, enabled, adapter, callbackAuth)
    subscribe,               // (hookName, handler) => void
    publishStudentResult,    // (payload) => Promise<boolean>
    publishGroupChatMessage, // (payload) => Promise<{ savedMessage, notificationPayload } | null>
    aiAdditionsClient,       // shared AI Additions HTTP client
}) {
    subscribe("student-response-submitted", async (context, { callback }) => {
        // Adapter logic.
    });
}
```

The `service` object passed to `register()` carries the normalized entry,
including `globalHooks`.

`register()` may declare additional optional parameters for test-only
dependency injection (for example `polyadicBridgeDependencies` in the Polyadic
adapter). The registry never passes them, so they must have safe defaults.

Adapters may also export pure helpers for testing; only `register` is part of the
registry contract. The adapter should subscribe only to hooks it handles.

Hook names are part of the adapter interface and must use kebab-case
(`/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`). Subscriptions and manifest entries with
other names are ignored with a warning.

### Handler signature

Every hook handler receives `(context, { callback })`:

- `context` is the object built by the dispatch site plus registry-injected
  fields. For hooks dispatched through `dispatchHook()` the registry adds
  `serviceId`, `jobId`, `correlationId` (equal to `jobId`), and
  `enabledServiceIds`. For `callback-received` it adds `serviceId`, `jobId`
  (the correlated job, if any), `resultId`, and `isDuplicate`.
- `callback(result)` records the adapter outcome against the job (see
  "Jobs and `callback(result)`" below).

Handlers run concurrently with `Promise.allSettled`; a throwing handler marks
its job as `failed` and never affects other services or the originating HTTP
request. Dispatch sites additionally wrap dispatch in `try/catch`, so adapter
failures are isolated from teacher and student requests.

## Hook Catalog

| Hook | Fired from | Enablement scope | Context fields (before registry injection) |
| --- | --- | --- | --- |
| `activity-started` | `POST /activities/:id/phase_transition` when the session enters `in_progress` (first phase only, see `helpers/activity-lifecycle-helper.js`) | Services enabled for the started phase | `sessionId`, `phaseId`, `startedPhaseId`, `endedPhaseId` |
| `phase-started` | Every phase transition | Services enabled for the started phase | `sessionId`, `phaseId` (= started), `startedPhaseId`, `endedPhaseId` |
| `phase-ended` | Phase transition, when a different phase was active before | Services enabled for the ended phase | `sessionId`, `phaseId` (= ended), `startedPhaseId`, `endedPhaseId` |
| `activity-finished` | `POST /activities/:id/finish` | Union of services enabled in any phase of the design | `sessionId`, `phaseId` (= last active), `startedPhaseId: null`, `endedPhaseId` |
| `student-response-submitted` | Student response endpoints in `controllers/activities/activities-student.js` | Services enabled for the phase | `sessionId`, `phaseId`, `userId`, `questionId`, `designType`, `requestPayload`, `responsePayload` |
| `chat-message-received` | `controllers/group-messages.js` after a group chat message is saved | Services enabled for the phase | `sessionId`, `phaseId`, `questionId`, `groupId`, `userId`, `parentId`, `content`, `savedMessage`, `notificationPayload`, `designType` |
| `callback-received` | `POST /external-services/callbacks` | Only the service named in the callback body | `serviceId`, `eventType`, `correlationId`, `eventId`, `requestPayload`, `rawBody`, `auth` |

### Hook enablement

Hooks are not broadcast to every registered adapter. `dispatchHook(hookName,
context, { enabledServiceIds })` only invokes subscribers whose `serviceId` is in
`enabledServiceIds`, and returns immediately when that list is empty. There are
two ways to resolve that audience:

**Phase-scoped hooks (activity design opt-in).** For activity hooks the
dispatch site resolves the audience from the activity design:
`design.phases[].externalServices.enabledServiceIds` (see
`canonical-schemas/ethicapp-v1.schema.json`, `helpers/designs-helper.js`, and
`helpers/activity-lifecycle-helper.js`). Teachers therefore opt a service into a
phase when authoring the design. All hooks in the catalog above except
`callback-received` are phase-scoped.

**Global hooks (manifest opt-in).** Hooks that fire outside an activity (no
session, phase, or design in scope) are dispatched with
`registry.dispatchGlobalHook(hookName, context)`. Its audience is
`registry.getGloballyEnabledServiceIds(hookName)`: every enabled service whose
manifest entry lists `hookName` in `globalHooks`. Opting in is an operator
decision taken in the manifest, like `enabled`; there is no teacher-facing UI
for it. `dispatchGlobalHook` delegates to `dispatchHook`, so jobs,
`correlationId`, `callback(result)` handling, and error isolation are identical.

`globalHooks` is only consulted by `dispatchGlobalHook`. Listing a phase-scoped
hook such as `phase-started` there has no effect, because the activity dispatch
sites never read it.

Jobs created by global hooks have `session_id`, `phase_id`, `question_id`, and
`group_id` set to `NULL`. Use the `hookName` filter of
`GET /external-services/jobs` and `GET /external-services/results` to find
them.

### Adding a new hook

1. Choose a kebab-case name and add it to the Hook Catalog above with its
   trigger, enablement scope, and context fields.
2. Decide the enablement scope. A hook that fires inside an activity is
   phase-scoped: dispatch it with
   `externalServicesRegistry.dispatchHook(hookName, context, { enabledServiceIds })`
   after resolving `enabledServiceIds` from the phase design. A hook that fires
   outside an activity is global: dispatch it with
   `externalServicesRegistry.dispatchGlobalHook(hookName, context)`.
3. Wrap the dispatch in a `try/catch` that logs and swallows errors, so adapter
   failures never break the user request.
4. Populate the correlating ids the jobs table understands (`sessionId`,
   `phaseId`, `questionId`, `groupId`, `userId`). All are nullable.
5. Add the hook to the `hooks` list of every manifest entry that subscribes to
   it, and to `globalHooks` as well when the hook is global.
6. Cover the dispatch logic with a `*.node-test.mjs` test using an injected or
   fake registry (see `services/__tests__/external-services-dispatch.service.node-test.mjs`).

## Jobs and `callback(result)`

Each `dispatchHook()` invocation creates one row per subscriber in
`external_service_jobs` (status `pending` then `dispatched`) and passes its id
as `jobId` and `correlationId` in the handler context.

Adapters report outcomes by calling the `callback(result)` function passed to
the handler. `result.status` drives the job status:

| `result.status` | Job status |
| --- | --- |
| `"failed"` | `failed` |
| `"skipped"` | `skipped` |
| anything else (adapters use `"completed"`) | `completed` with `completed_at` |

Other fields in `result` are free-form and are persisted as `adapter_result`
when the callback happens inside a `callback-received` handler. `callback()` is
for recording adapter outcomes, not for communicating with AI Additions.

Asynchronous integrations keep the job `dispatched` after the outbound request
and call `callback()` from the `callback-received` handler once the provider
posts its result. Jobs and results are queryable through
`GET /external-services/jobs`, `GET /external-services/jobs/:jobId`, and
`GET /external-services/results` (roles `P` and `A`). The list endpoints accept
`serviceId`, `hookName`, `sessionId`, `phaseId`, `status`, `from`, `to`, and
`limit` query filters.

## Inbound Callbacks

Providers post results to `POST /external-services/callbacks`. The request is
authenticated by `middleware/external-services-callback-auth.middleware.js`
(see "Inbound callback authentication" below) and must carry:

```json
{
  "serviceId":     "argumentation-tutor-system",
  "eventType":     "result",
  "correlationId": "<job uuid echoed from the outbound request>",
  "eventId":       "<optional uuid, used for idempotency>",
  "payload":       { }
}
```

- `serviceId` is required and must match an enabled manifest entry.
- `eventType` defaults to `"result"`.
- `correlationId` is matched against `external_service_jobs.id`; the response
  reports `correlationStatus: "matched"` or `"unknown"`.
- `eventId`, when provided, must be a UUID. A repeated `eventId` for the same
  service is recorded as a duplicate and is **not** dispatched to the adapter.

The registry creates an `external_service_results` row, then dispatches
`callback-received` only to the subscribers of the named service with the
context listed in the Hook Catalog. The endpoint answers `202` with
`{ status: "accepted", result: { ..., correlationStatus, resultId, isDuplicate, dispatched } }`.

## Available Hook Publishers

The registry provides two helper publishers to adapters:

- `publishStudentResult(payload)`: sends a socket notification to a student.
  The payload must include a valid positive integer `userId`; the registry adds
  `serviceId` and `receivedAt`. Returns `true` when the notification was sent,
  `false` otherwise.
- `publishGroupChatMessage(payload)`: saves a message authored by the external
  service and publishes chat notifications to the group and the teacher. The
  payload must include `content`, `phaseId`, `questionId`, and `groupId`;
  `sessionId`, `parentId`, and `agentDisplayName` are optional but should be
  provided when available. The agent identity is upserted in
  `external_service_agents` by `serviceId`. Returns
  `{ savedMessage, notificationPayload }` or `null` when the payload is
  incomplete or the message could not be saved.

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

Argumentation Tutor completion is callback-driven. EthicApp submits the task and
keeps the external-service job dispatched until the correlated `result` callback
arrives; it does not poll the ATS task-status endpoint.

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

1. Add the adapter module under `adapters/` as an ES module.
2. Export a named `register()` function and subscribe to the hooks the service
   needs. Only hooks listed in the Hook Catalog are dispatched; subscribing to
   an unknown name is silently inert.
3. Add a service entry to `manifest.json` with the same hook list, including
   `callbackAuth` if the service posts inbound callbacks and `capabilities` if
   the service processes student responses.
4. Use `aiAdditionsClient.requestJson()` for AI Additions HTTP calls and forward
   `context.correlationId` in outbound requests.
5. Keep service-specific URL configuration under an `AI_ADDITIONS_<SERVICE>_*`
   prefix.
6. Subscribe to `callback-received` to handle inbound callbacks from the service
   and close the job by calling `callback()` there.
7. Publish outcomes through `publishStudentResult`,
   `publishGroupChatMessage`, or the hook `callback()` as appropriate. Always
   call `callback()` with a `status`, including `"skipped"` when the adapter
   decides not to act, so the job does not stay `dispatched` forever.
8. Add focused backend tests under `adapters/__tests__/` (`*.node-test.mjs`).
   Call `register()` with a fake `subscribe` that captures handlers and with
   fake publishers, as the existing Polyadic and ATS tests do.

Avoid putting secrets or Keycloak client-credentials logic inside adapters. The
adapter boundary should stay focused on translating EthicApp hook context into
service-specific AI Additions requests and translating service responses back
into EthicApp notifications or callback records.
