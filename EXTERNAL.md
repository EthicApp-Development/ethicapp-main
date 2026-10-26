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

External services are registered through a single adapter catalog, shipped
as code (#812):

```text
ethicapp/backend/external-services/manifest.json
```

Each manifest entry declares:

- `id`: stable external service identifier.
- `description`: teacher-facing description.
- `adapter`: ESM module path relative to the manifest.
- `hooks`: hook names supported by the service.
- `scopes`: where the service operates: `case`, `response` or `chat`. Screens
  list services by scope.
- `ui`: `{ component }`, the EthicApp component that will show the service's
  analysis in the case view.
- `requires`: the AI Additions services the adapter talks to (`polyadic-agent`,
  `argumentation-tutor`, `case-analyst`). Mandatory; the AI service policy
  allows an adapter only when it allows all of them.
- `development`: `true` for the mock adapters, which require no AI Additions
  service (`requires: []`) and register only with
  `EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true`.
- `descriptor`: `{ path }`, the capability descriptor that the AI service
  publishes (`GET <path>` under the AI Additions connection's `base_url`). Its id is the one
  service in `requires`, mapped to the catalog `id` instead of renamed.

There is no `enabled`: the catalog lists adapters, and whether one may be used
is decided at dispatch by the AI service policy gate
(`effectiveServiceIds()` in the registry, #815). A production adapter is usable
when the policy version in force allows every service in its `requires` and a
valid AI Additions connection is stored. Session hooks follow the version the
session was pinned to at launch; `case-created`, the teacher listings and
callbacks follow the current version. Development adapters are usable whenever
they are registered. See `ethicapp/backend/external-services/README.md`,
"Usability".

Hook names are standardized as kebab-case identifiers. New adapters should use
names such as `phase-started`, `phase-ended`, `activity-started`,
`activity-finished`, `chat-message-received`, `student-response-submitted`, and
`callback-received`.

Adapters are ESM modules that export `register(...)`. During startup,
`externalServicesRegistry.initialize()` validates the catalog, imports every
production adapter (and the development ones when enabled), and lets it
subscribe to hooks. Registering makes no outbound call.

The current register contract is:

```js
export async function register({
  service,
  subscribe,
  publishStudentResult,
  publishGroupChatMessage,
  aiAdditionsClient,
  caseAnalyses
}) {
  // Subscribe to hooks here.
}
```

The `aiAdditionsClient` parameter is the only place adapters should obtain
Keycloak-protected access to AI Additions.

Adapters may also export `getUiTranslations()`, which returns the texts
teachers read about the service: a label, a description and a case-view tab
title in `es_CL` and `en_US`. The service owns those texts and the adapter
obtains them. See "UI translations" in
`ethicapp/backend/external-services/README.md`.

Case-scoped adapters record their results through `caseAnalyses`
(`markProcessing`, `complete` and `fail`, bound to their service) and may export
`validateCaseAnalysisDocument()` to accept teacher edits. See "Case Analyses"
in the same README.

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

It creates one tutor session per EthicApp session and phase, on the first
student response. When the phase configures `llm_tier`
(`context.serviceConfiguration`, #734), the creation request sends it (#736);
otherwise the tutor uses its default tier. The deprecated `model` is not sent.
The tutor's `llm_tier`, resolved `model`, `warnings` and `degraded` come back
in the `student-response-submitted` handler's result as `sessionCreation`. If
the tutor rejects the configured tier (400), the session is created with its
defaults and reported with `configurationRejected: true`.

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

Where the facade is comes from the **AI Additions connection** stored in the
database (`ai_additions_connection`), edited by operators in the management
console (#817), not from environment variables (#814). The connection holds
`base_url` and an optional `keycloak_public_url`. From it EthicApp derives:

- the token endpoint,
  `base_url/keycloak/realms/<realm>/protocol/openid-connect/token`;
- the JWKS URL for callbacks,
  `base_url/keycloak/realms/<realm>/protocol/openid-connect/certs`;
- the callback issuer it expects,
  `<keycloak_public_url or base_url/keycloak>/realms/<realm>`;
- each service API, `base_url` plus the adapter's normalized facade path, for
  example `/argumentation-tutor/api/v2` or `/polyadic-agent/api`.

Keycloak is always reached through `base_url`, because the public Keycloak URL
may not be reachable from inside the EthicApp container; `keycloak_public_url`
only sets the expected issuer. **Without a connection EthicApp makes no AI
call**: every call fails with `not_configured` before any request is sent.

The remaining `AI_ADDITIONS_*` variables are:

- `AI_ADDITIONS_KEYCLOAK_REALM`, defaulting to `ethicapp-ai-additions`;
- `AI_ADDITIONS_KEYCLOAK_CLIENT_ID` and `AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET`,
  the confidential client used by EthicApp (deployment secrets);
- `AI_ADDITIONS_KEYCLOAK_SCOPE` and `AI_ADDITIONS_HTTP_TIMEOUT_MS`;
- `AI_ADDITIONS_POLYADIC_AGENTS_AUTHENTICATED` and
  `AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE`.

In local development, until the console page exists, insert the connection
row directly; for AI Additions running on the host:

```bash
docker compose exec postgresql psql -U postgres -d ethicapp -c \
  "INSERT INTO ai_additions_connection (id, base_url) VALUES (1, 'http://host.docker.internal:8010') ON CONFLICT (id) DO UPDATE SET base_url = EXCLUDED.base_url;"
```

The shared client obtains and caches client-credentials tokens, attaches Bearer
authorization headers, and retries once after a `401`. Adapter code should focus
on translating EthicApp hook context into service-specific requests.

### Internal endpoints for the management console

The management console holds no AI Additions credentials. Its AI services page
(#817) reads the AI Additions catalog and tests a connection through two
ethicapp endpoints (#816, `controllers/admin/ai-services.js`). Like the
impersonation start endpoint, they are reached over the internal network only:
NGINX answers `404` for `/api/admin/` at the edge in any letter case
(`location ^~ /api/admin/` plus `location ~* ^/api/admin/`), except the exact
`/api/admin/impersonation/stop`. `npm run test:nginx-config` and
`npm run test:nginx-edge` check this. The ethicapp routers for `/api/admin/` are
case-sensitive, so no other spelling reaches a handler. The endpoints require a
session with role `S` (the console forwards the operator's cookie and identity
headers); other roles get `403`.

- `GET /api/admin/ai-services/catalog?locale=es_CL|en_US` reads
  `GET <base_url>/catalog/v1/services` with
  `Accept-Language: es-CL` or `en-US`. It reads the stored connection from the
  database on every call, bypassing the client's 5 s connection cache, and binds
  the token and the catalog request to that snapshot. A catalog requested right
  after the console saves or removes the connection therefore describes the new
  one. It answers
  `{ ok: true, contractVersion, locale, services: [{ id, name, description, usesLlm, status, available, adapters }] }`,
  where `adapters` lists the non-development adapters of the catalog in
  `manifest.json` whose `requires` include the service, as `{ id, description }`.
- `POST /api/admin/ai-services/connection-test` with
  `{ baseUrl, keycloakPublicUrl? }` obtains a token, checks its issuer and
  reads the catalog against those URLs without saving them, with its own token
  cache. It answers
  `{ ok, token: { ok, error? }, issuer: { ok, error?, skipped?, expected, actual? }, catalog: { ok, error?, skipped? }, serviceCount }`;
  `ok` is `true` only when all three steps pass. `issuer.skipped` and
  `catalog.skipped` are `true` when no token was obtained. Both URLs must be
  `http(s)://<authority>[/<path>]`, with no userinfo, query or fragment;
  anything else gets `400`.

The issuer step (#834) catches a wrong Keycloak public URL before it is saved.
Tokens are always requested through `base_url`, so the token step succeeds
even when `keycloakPublicUrl` is wrong; the mistake would only show later, when
every AI Additions callback fails verification. Keycloak writes its public
hostname (`KC_HOSTNAME`, AI Additions' `KEYCLOAK_PUBLIC_URL`) into `iss`,
whatever host the token was requested through. The step:

- decodes the token's payload without verifying it (the token comes straight
  from the Keycloak the test just called) and reads `iss`;
- compares it with `expected`, the issuer callbacks are verified against:
  `<keycloakPublicUrl or baseUrl/keycloak>/realms/<realm>`, derived by the
  same code as the callback verification (`getEndpoints().issuer`);
- compares exactly, letter case included, after removing a single trailing
  slash from each side. Keycloak issuers have no trailing slash, and neither
  has `expected`, so the tolerance only covers a hand-typed slash;
- answers `issuer_mismatch` with `expected` and `actual` when they differ, or
  `invalid_response` (with `expected` only) when the token is not a JWT or its
  payload has no `iss` that is an `http(s)` URL of at most 2048 characters.

The catalog step still runs after an issuer failure, since the two are
independent. Only `expected` and `actual` (the `iss` URL) leave the step: the
token and its other claims are never returned or logged. On a mismatch, the
management console shows both issuers and suggests the Keycloak public URL that
matches the token: `actual` without its `/realms/<realm>` suffix. When the
realm itself differs (`AI_ADDITIONS_KEYCLOAK_REALM`), it says that no Keycloak
public URL fixes it. A console talking to an ethicapp without the issuer step
shows the token and catalog steps only.

Failures are typed results with status `200`:

| Code | Cause |
| --- | --- |
| `not_configured` | No stored connection (catalog only); no request is sent. |
| `unreachable` | Network error, DNS failure, timeout, or a `502`/`503`/`504` from the gateway. |
| `unauthorized` | `401`/`403` from the token endpoint or the catalog, or no client credentials in the environment. |
| `invalid_response` | Any other status, a non-JSON body, a token response without `access_token`, a token that is not a JWT with an `http(s)` `iss` (issuer step), or a catalog outside contract version `1`. |
| `issuer_mismatch` | Issuer step only: the token's `iss` differs from the expected issuer. |

Each step answers within the console's timeouts (12 s for the catalog; 8 s for
the token and 8 s for the catalog in the test). Neither route logs tokens,
secrets or response bodies: a failure is logged as its code, plus the HTTP
status or the error class.

The Polyadic Agents bridge calls `base_url/polyadic-agent/api` and creates one
Polyadic REST room per EthicApp session/phase/group. When it creates a room's
session (#735) it sends:

- the phase's configured settings (`context.serviceConfiguration`, #734), such
  as `pipeline_type`, `llm_tier`, `session_duration_seconds` or
  `agent_nickname`;
- for settings the phase does not configure, EthicApp's defaults: the pipeline
  from `AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE` (default
  `abogado-del-diablo`), and the guide nickname and `locale` (`es-CL` or
  `en-US`) from the design language. The deprecated `idioma` is no longer sent.

Anything still unset takes Polyadic's defaults. Polyadic's `warnings` and
`degraded` flags come back per room in the `phase-started` job result
(`payload.rooms`). If Polyadic rejects the configured settings (400, a value a
newer rule no longer accepts), the room is created again with EthicApp's
defaults and reported with `configurationRejected: true`.

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
It also drops the services the AI service policy gate does not let through
(`effectiveServiceIds()`, #815: the session's pinned policy version and the
connection), so a design that selects one reaches nothing for it and creates no
job.

Each handler also receives `context.serviceConfiguration` (#734): the settings
the phase stores for that service in
`externalServices.configurations[serviceId]` (see "Design Schema"), or `{}`
when there are none or the hook has no phase. Adapters pass these values to
the AI service when they create rooms or sessions; a key that is not set means
the service default.

`case-created` follows the same rule for cases: it reaches only the services the
teacher chose when creating the case (`analysisServiceIds` in `POST /cases`).
They store their results in `case_analyses`, which the case creator reads,
edits and regenerates through `/cases/:id/analyses`. Each generation is reserved
in `case_analyses` before it is dispatched, so concurrent generations and
teacher edits cannot overlap it; a reservation that its adapter does not start
is released.

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
- `activity-started`: dispatched once when the teacher transitions a session into
  `in_progress` (its first phase), so adapters can run any preparation/warm-up.
  It does not fire on ordinary phase-to-phase advances. Resolved against the
  services enabled for the phase being entered.
- `activity-finished`: dispatched when the teacher finishes an activity, so
  adapters can run any required cleanup (close rooms, release provider sessions,
  flush state). Resolved against the **union of services enabled across all
  phases** of the activity design, so any service that may have opened
  provider-side state is notified to clean up regardless of which phase the
  activity finishes on (including early/incomplete finishes). Replaces the earlier
  single-service `session-ended` hook.

> **Enabled-service resolution differs by lifecycle hook.** `activity-started` is
> phase-scoped (resolved from the phase being entered, since preparation is
> relevant to that phase). `activity-finished` resolves against the union of
> enabled services across all phases of the design, guaranteeing that no
> provider-side state leaks past the end of the activity.

The phase transition and `activity-started` hooks are dispatched from:

```text
ethicapp/backend/controllers/activities/activities-teacher.js
POST /activities/:session_id/phase_transition
```

The `activity-finished` hook is dispatched from:

```text
ethicapp/backend/controllers/activities/activities-teacher.js
POST /activities/:session_id/finish
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

Adapters can subscribe to the activity-lifecycle hooks to prepare or clean up
provider-side state. These are broadcast (fire-and-forget) to the services
enabled for the relevant phase:

```js
export async function register({ service, subscribe, callback }) {
  subscribe("activity-started", async (context) => {
    // context.sessionId, context.phaseId (the first phase entered)
    // Warm up / allocate any provider resources for the activity here.
  });

  subscribe("activity-finished", async (context, { callback }) => {
    // context.sessionId, context.phaseId (the last active phase)
    // Release provider sessions / flush state here.
    await callback({
      serviceId: service.id,
      hook:      "activity-finished",
      status:    "completed",
      payload:   { sessionId: context.sessionId },
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

## Frontend Architecture

The teacher design editor loads the services that work on student responses or
group chats from:

```text
GET /external-services?scope=response&scope=chat
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

The editor initializes each phase with
(`frontend/assets/js/helpers/phase-external-services.js`):

```json
{
  "externalServices": {
    "enabledServiceIds": [],
    "configurations": {}
  }
}
```

When a teacher enables a service for a phase, the service id is added to
`phase.externalServices.enabledServiceIds`. That configuration is saved as part
of the design JSON. Per-service settings go in `configurations` (see "Design
Schema"); turning a service off keeps them.

Settings form (#732): when an enabled service has a capability descriptor, the
editor shows its fields below the service, in the UI language
(`components/service-configuration-form.component.js`,
`fragments/service-configuration-form.template.html`,
`helpers/service-configuration-form.js`):

- one control per field: a select for `enum`, a number input for `integer` and
  `number`, a checkbox for `boolean`, a text input or textarea for `text`;
  grouped by `group`, ordered by `order`, with the description as help text;
- defaults show as placeholders; only values the teacher sets are stored, and
  "Use default" removes a value;
- deprecated fields and enum values are offered only while a design stores
  them;
- lifecycle notices (#733) for stored values, matching the server's save
  warnings (#731): a deprecated field or value says so and offers a switch to
  its `superseded_by` replacement; a retired enum value stays visible in the
  select, flagged with the default the service applies instead; a value that
  breaks a current rule says the service may refuse it; settings the
  descriptor no longer defines are listed with a "Remove" button. Notices never
  block saving;
- values are checked as the teacher types with the server's rules
  (`common/modules/service-configuration-rules.js`); errors block saving, and
  the server's field errors (#731) show next to their fields;
- when the service does not respond, a notice lists the stored values, which
  are kept unchanged;
- locked designs show the settings read-only;
- services that use a language model carry a notice.

The design and activity views show the same settings read-only (#757):
`components/phase-external-services-summary.component.js` lists, below each
phase that enables services, each service's name and its settings in the UI
language, with defaults marked and the editor's lifecycle notices. When a
service does not respond, or is not available in the installation, the view
shows a notice and the stored settings as `key: value`. Phases without
services show nothing.

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
canonical-schemas/ethicapp-v1.schema.json
```

```json
"externalServices": {
  "enabledServiceIds": ["polyadic-devils-advocate"],
  "configurations": {
    "polyadic-devils-advocate": { "pipeline_type": "devilsAdvocate", "llm_tier": "basic" }
  }
}
```

- `enabledServiceIds` is optional and contains unique service ids.
- `configurations` is optional (#729). Its keys are manifest service ids; each
  value maps capability descriptor field keys to scalar values (string, number,
  boolean or null). A configuration for a service that is not in
  `enabledServiceIds` is kept but ignored, so turning the service off and on
  again keeps the teacher's values. Duplicating a design copies it.
- Older designs without `externalServices`, or without `configurations`,
  remain valid.

`npm run test:schemas` validates the schema rules and the canonical seeds.

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
| `EXTERNAL_SERVICES_CALLBACK_AUTH_AUDIENCE` | Expected `aud` claim. Defaults to `ethicapp-ai-services` (the audience injected by the Keycloak mapper in AI Additions). Leave empty to skip audience check. |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_CLOCK_TOLERANCE_SECONDS` | Clock skew tolerance. Defaults to `30`. |

The issuer and JWKS URL derive from the AI Additions connection (see "AI
Additions and Keycloak"). Without a connection, callbacks are rejected with
`503` and `code: "not_configured"`.

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
