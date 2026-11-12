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
- `scopes`: where the service operates: `case`, `design`, `response` or
  `chat`. Screens list services by scope, and the management console groups
  the adapters of each AI Additions service by scope.
- `ui`: `{ component }`, the EthicApp component that will show the service's
  analysis in the case view.
- `requires`: the AI Additions services the adapter talks to (`polyadic-agent`,
  `argumentation-tutor`, `case-analyst`). Mandatory; the AI service policy
  allows an adapter only when it allows all of them and does not switch the
  adapter itself off.
- `development`: `true` for the mock adapters, which require no AI Additions
  service (`requires: []`) and register only with
  `EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true`.
- `descriptor`: `{ path }`, the capability descriptor that the AI service
  publishes (`GET <path>` under the AI Additions connection's `base_url`). Its id is the one
  service in `requires`, mapped to the catalog `id` instead of renamed.

There is no `enabled`: the catalog lists adapters, and whether one may be used
is decided at dispatch by the AI service policy gate
(`effectiveServiceIds()` in the registry, #815). A production adapter is usable
when the policy version in force allows every service in its `requires`, does
not list the adapter in its `disabled_adapter_ids` (#864, V26), and a valid AI
Additions connection is stored. Session hooks follow the version the session
was pinned to at launch; case and design hooks, the teacher listings and
callbacks follow the current version. Switching an adapter off in a new
version therefore never affects a running activity's session hooks. Development adapters are usable whenever
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

It creates one tutor session per EthicApp session, phase and question, on the
first student response to the question (#850). A session runs in the enhanced
mode, with the case's evidence inventory and the question's claim typology as
`case_context`, when both are available, and otherwise in the basic mode; the
mode and its reason are recorded and shown to teachers (#865, see "The tutor's
modes" in `ethicapp/backend/external-services/README.md`). When the phase
configures `llm_tier` (`context.serviceConfiguration`, #734), the creation
request sends it (#736);
otherwise the tutor uses its default tier. The deprecated `model` is not sent.
The tutor's `llm_tier`, resolved `model`, `warnings` and `degraded` come back
in the `student-response-submitted` handler's result as `sessionCreation`. If
the tutor rejects the configured tier (400), the session is created with its
defaults and reported with `configurationRejected: true`.

Its `callback-received` handler publishes the tutor's feedback to the student
with the id of the stored callback as `resultId` (#1126). Its
`student-results-reading` handler rebuilds that feedback from the stored
callbacks when the student loads the activity (see "Student results
reading").

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

Operators configure the connection, and the AI service policy that decides
which services may be used and which of their adapters are switched off, on
the management console's AI services page;
`INSTALL.md` ("AI Services (AI Additions)") covers the installation scenarios
and the local development setup.

The shared client obtains and caches client-credentials tokens, attaches Bearer
authorization headers, and retries once after a `401`. Adapter code should focus
on translating EthicApp hook context into service-specific requests.

### Internal endpoints for the management console

The management console holds no AI Additions credentials. Its AI services page
(#817) reads the AI Additions catalog and tests a connection through two
ethicapp endpoints (#816, `controllers/admin/ai-services.js`), and its user
page reads and retries the AI Additions erasure requests of a forgotten
account through two more (#876, `controllers/admin/user-erasure.js`). Like the
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
  `manifest.json` whose `requires` include the service, as
  `{ id, scopes, label, description }`. `scopes` comes from the manifest;
  `label` and `description` are the adapter's `getUiTranslations()` texts in
  the requested locale (#864). When an adapter gives none, `label` is `null`
  and `description` is the manifest's. The console groups the adapters by
  scope (case analyses, design analyses, responses, chat) and offers a switch
  for each, so it shows, for example, that Case Analyst runs three case
  analyses and one design analysis (the claim typology).
- `POST /api/admin/ai-services/connection-test` with
  `{ baseUrl, keycloakPublicUrl? }` obtains a token, checks its issuer and
  reads the catalog against those URLs without saving them, with its own token
  cache. It answers
  `{ ok, token: { ok, error? }, issuer: { ok, error?, skipped?, expected, actual? }, catalog: { ok, error?, skipped? }, serviceCount }`;
  `ok` is `true` only when all three steps pass. `issuer.skipped` and
  `catalog.skipped` are `true` when no token was obtained. Both URLs must
  follow the console's connection URL rule (`isValidAiAdditionsUrl`, #834):
  `http(s)://<authority>[/<path>]`, with no userinfo, query, fragment,
  backslash, whitespace or `.`/`..` segment, a valid host and port, and at
  most 2048 characters; anything else gets `400`. The same rule decides
  whether a stored connection is usable.
- `GET /api/admin/user-erasure/users/:id` lists the AI Additions erasure
  requests of an account (`user_erasure_requests`, V31), one per service, and
  summarizes the deletion of the upload files it freed
  (`upload_deletion_requests`, V32, #877):
  `{ ok: true, userId, requests: [{ serviceId, status, attempts, nextAttemptAt, lastAttemptAt, lastError, requestedAt, completedAt }], uploadDeletions: { total, pending, retrying, done, skipped, failed, lastError } }`.
  `status` is `pending`, `done` or `failed`; `lastError` is an upper-case
  code. An account that was never forgotten has `requests: []` and a zero
  `uploadDeletions.total`. Students and teachers (#877) get the same
  requests: a forgotten teacher's chat messages may have reached Polyadic.
- `POST /api/admin/user-erasure/users/:id/retry` sets every request and file
  deletion of the account that is not complete back to `pending`, due now and
  with a fresh backoff, attempts them at once, and answers like the status
  endpoint plus `retried`, how many it reset. An invalid id gets `400`.

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
| `credentials_missing` | `AI_ADDITIONS_KEYCLOAK_CLIENT_ID` or `AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET` is empty or unset in EthicApp's environment (catalog, and the token step of the test); no request is sent. |
| `unreachable` | Network error, DNS failure, timeout, or a `502`/`503`/`504` from the gateway. |
| `unauthorized` | `401`/`403` from the token endpoint or the catalog. |
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
  as `pipeline_type`, `llm_tier` or `agent_nickname`, and the deprecated
  `session_duration_seconds` that older designs store;
- for settings the phase does not configure, EthicApp's defaults: the pipeline
  from `AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE` (default
  `abogado-del-diablo`), and the `locale` (`es-CL` or `en-US`) from the design
  language. The deprecated `idioma` is no longer sent;
- for a timed phase, the phase clock as the session input `phase_clock`
  (#1178, see "Polyadic phase clock" below).

Anything still unset takes Polyadic's defaults. `agent_nickname` is sent only
when the phase configures it (#1026, epic #1025): without it, Polyadic names
the guide by the room's locale, `agente` in `es-CL` and `agent` in `en-US`, and
students address it with `@agente` or `@agent`. Polyadic reports the name each
room shows for an agent as the `display_name` of every callback evaluation,
which the bridge publishes as the message's author (see "Chat-agent
identity" below). Polyadic's `warnings` and
`degraded` flags come back per room in the `phase-started` job result
(`payload.rooms`). If Polyadic rejects the configured settings (400, a value a
newer rule no longer accepts), the room is created again with EthicApp's
defaults and reported with `configurationRejected: true`.

Each room also gets a room job (#833): a long-lived job for that room whose id
EthicApp sends as the top-level `ethicapp_room_correlation_id` of
`POST /rooms/:room/sessions`. Polyadic uses it as the `correlationId` of the
room's proactive callbacks (session start, timer ticks and milestones,
inactivity, window events), so each of them is matched to that room's job,
deduplicated by its `eventId`, and refused (`409`) once the phase has ended.
When Polyadic echoes the id in its response the room is bound, and a callback
without a job that names it is refused (`409`); an older Polyadic does not echo
it, and its rooms keep the verified-destination rule. A room created again
(lazily, for example after a restart) gets a new id that supersedes the old
one. See `ethicapp/backend/external-services/README.md`, "Room jobs".

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

- `POST /response-review/student-result`: receives response text and a
  `locale` (`es-CL` or `en-US`; anything else gives `es-CL`) and returns a
  mock review of it as a `student-result/v1` document
  (`external-mock-service/student-result.js`): an overview, criteria with
  descriptions, bullets, the text backwards, a comparison, and a section of a
  kind v1 does not define, which renderers skip.
- `POST /chat-agent/respond`: receives a chat message and returns a processed
  chat-agent reply containing the processed message followed by its character
  count.

### Polyadic phase clock

A Polyadic room follows the clock of its phase (#1178, epic #1105), so the
guide's time milestones (25, 50 and 75 % of the phase) match the deadline
participants see, the minutes the teacher adds included. Polyadic's side is
ethicapp-ai-additions#259, implemented by ethicapp-ai-additions#260 ("Phase
clock" in `polyadic-agents/README.md`): a
room created without a clock is untimed, with no milestones and no time
notices to the agents.

- **Room creation.** When the phase has a clock (a duration, in an activity
  whose time mode is not `none`), `POST /rooms/:room/sessions` carries, next
  to `ethicapp_room_correlation_id` and never from the phase's settings:

  ```json
  { "phase_clock": { "duration_seconds": 900, "remaining_seconds": 884 } }
  ```

  `duration_seconds` is `stages.ends_at - stages.started_at`, extensions
  included; `remaining_seconds` is `ends_at` minus the database's
  `clock_timestamp()`, read (`helpers/phase-clock.js`) right before each
  room's request, including a room created late by the first chat message and
  the retry without configured settings. It is negative after the deadline:
  in soft mode, and on a hard-mode last phase, which its deadline never
  finishes. Both are whole seconds within Polyadic's bounds (duration 60 to
  86400, remaining time from -86400 to the duration). An untimed phase, a
  phase that is no longer current or a clock that cannot be read sends no
  `phase_clock`, and the room is created untimed.
- **"+1 min".** After an extension commits, `POST
  /activities/:id/phases/:phase_id/clock/extend` dispatches
  `phase-clock-changed` without waiting for it. The bridge sends
  `PUT /rooms/:room/sessions/active/clock` with `{ "phase_clock": {...} }`,
  read again for each request, to the room of every group of the phase,
  waiting first for a room still being created. A `404` (no running session)
  counts as not running; any other failure is logged and reported in the job
  result, and never undoes the extension.
- **Discovery.** EthicApp sends `phase_clock`, at creation and after an
  extension, only when Polyadic's capability descriptor declares
  `session_inputs.phase_clock`, read through the descriptor cache (ten
  minutes; see "Capability descriptors" in
  `ethicapp/backend/external-services/README.md`). Against an older Polyadic,
  or while the descriptor is unavailable, no clock is sent and the rooms run
  as before.
- **Deprecated duration.** `session_duration_seconds` carries
  `status: "deprecated"` in the descriptor, so the design editor no longer
  offers it and shows it, with its deprecation notice, only on designs that
  store it (#733). Such a design still sends it; Polyadic gives the room a
  fixed clock from its start, unless a `phase_clock` comes in the same
  request, which wins.

The `phase-started` job result reports each timed room's clock as
`payload.rooms[].phaseClock`, and the `phase-clock-changed` result reports
`roomsUpdated`, `roomsNotRunning`, `roomsFailed` and each room's outcome and
clock.

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

An activity launched with its AI services turned off (`aiServices: false` on
`POST /activities`, stored in `sessions.ai_services_enabled`, #970) enables no
service in any phase: `getPhaseExternalServices()` and
`getEnabledExternalServiceIdsBySessionId()` (`helpers/designs-helper.js`)
return none for its session, whatever the design selects. No session hook
reaches a service and no job is created, a callback without a job is refused,
and the student app is given no usable services. `phase-ended` and
`activity-finished` still reach the registry, which closes the session's room
jobs. The design is not changed.

Each handler also receives `context.serviceConfiguration` (#734): the settings
the phase stores for that service in
`externalServices.configurations[serviceId]` (see "Design Schema"), or `{}`
when there are none or the hook has no phase. Adapters pass these values to
the AI service when they create rooms or sessions; a key that is not set means
the service default.

Phase hooks and `student-results-reading` also carry `context.locale` (#1124):
the activity's locale, `es_CL` or `en_US`, from the design's
`designs.language_code` (`helpers/activity-locale.js`). Services write the
texts they show students in that language.

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
- `phase-clock-changed`: dispatched after the teacher adds a minute to the
  current phase's deadline (#1112), so services can follow the new clock
  (#1178, see "Polyadic phase clock").
- `chat-message-received`: dispatched when a chat message is posted to a phase
  group chat.
- `callback-received`: dispatched when an external service calls the callback
  endpoint. Replaces the earlier `external-service-result` hook.
- `activity-started`: dispatched once when the teacher transitions a session into
  `in_progress` (its first phase), so adapters can run any preparation/warm-up.
  It does not fire on ordinary phase-to-phase advances. Resolved against the
  services enabled for the phase being entered.
- `participant-activity`: an ephemeral hook (epic #601, #654), dispatched
  with `dispatchEphemeralHook()` while a participant writes in a group chat,
  without jobs or callbacks (see "Composing signal").
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
ethicapp/backend/helpers/phase-start-helper.js
POST /activities/:session_id/phases/next (after its transaction commits)
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
student-facing result without requiring a real asynchronous provider (#1134).
It sends the submitted free-text response to the mock service, publishes the
`student-result/v1` document the service returns to the student who submitted
the response through `publishStudentResult(...)`, and records counts in the
job's callback result. The document is in the activity's language
(`context.locale`, `es-CL` or `en-US`), and in `es-CL` when the hook carries no
locale. When the mock service does not answer, the adapter publishes a
document with `status: "unavailable"`. Its catalog entry declares the
document's schema (see "Student output declaration").

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
- `source`: `{ kind: "chat_message", id }`, the saved message's id
  (`differential_chat`, or `chat` for ranking), or `null` when the insert
  returned no row

The student response hook's context likewise carries `source:
{ kind: "response", id }`, the stored `differential_selection` row (or
`actor_selection` for ranking). The registry writes a hook's `source` to the
`source_kind` and `source_id` columns of each job it creates (#946), and the
handler of a callback correlated with that job reads it back as
`context.job.source`. Jobs of other hooks keep both columns `NULL`.

Groups are ephemeral in EthicApp and are scoped to a phase. Chat-oriented
adapters should therefore key any accumulated conversation state by at least
`phaseId` and `groupId`.

### Report contributions

`report-building` (epic #620, #944) is a hook with its own collecting
dispatch, `registry.collectReportContributions(reportType, context)`, not
`dispatchHook()`, which ignores it. While an activity report is built, it asks
the adapters of the services that are registered, subscribed to the hook and
have at least one job in the session, whatever the AI service policy says
today. Each handler is awaited under a 5-second timeout and returns a
contribution: columns keyed by the report's rows and, for the chat transcript,
rows of its own. It reads its stored results through a reader limited to its
own service and the report's session. No job or result row is created and no
AI service is called. A handler that fails, times out or returns an invalid
contribution gets its own outcome and is left out; the others are unaffected.

Both semantic-differential reports merge the completed contributions (#945):
columns after the report's own, by service in subscription order, and, in the
chat transcript, contributed rows attributed to the service and placed by
time. Contributed rows must name a phase, question and group of the session.
The export's audit row records each contribution's outcome and counts, never
its values. Without contributions the CSV is unchanged byte for byte. The dev
mock adapters `mock-ai-response-review` and `mock-chat-agent` contribute, for
local verification.

The Polyadic bridge contributes to the chat transcript (#949). Each agent
message it published from a callback (#947) gets `polyadic_agent_name`, the
agent that wrote it (from the callback; for a callback redacted before V44
kept agent names, from the message row's agent, #1155), `polyadic_agent_trigger`, `polyadic_agent_in_reply_to`
and `polyadic_agent_visible_to_students = true`. Each evaluation a callback
carried but the bridge did not publish becomes a row at the callback's receipt
time, with the same columns and `polyadic_agent_visible_to_students = false`.
The callback handler records, for each message it publishes, the index of the
evaluation it came from (`publishedMessages[n].evaluationIndex`), so each
unpublished evaluation is added exactly once. For callbacks stored without
that index, a chat agent's evaluations are added only when none of its
evaluations was published; when some were, which ones failed cannot be told,
and none is added. The trigger is `reactive` only when the callback correlates with the
`chat-message-received` job of a student message, whose id is then
`polyadic_agent_in_reply_to`; it is `unknown` otherwise, since Polyadic sends
both its proactive interventions and its window-event replies on the room's
correlation id (#833). Messages published before #947 get no values.

The contract, the reader and the catalog's `report.columnPrefix` are described
in `ethicapp/backend/external-services/README.md`, "Report building".

### Student results reading

`student-results-reading` (epic #1123, #1125) is the second collecting hook,
dispatched by `registry.collectStudentResults({ sessionId, userId })` when a
student loads an activity. `publishStudentResult` only emits a socket event,
so each adapter rebuilds, from its stored callbacks, the results it published
to that student in that session. No copy of a published result is stored.

It asks the subscribed services that the session's design enables in any
phase (none when the activity was launched with its AI services off) and
that the session's pinned policy version allows; the AI Additions connection
is not required, since no service is called. Each handler is awaited under a
3-second timeout with `{ serviceId, sessionId, userId }` and a reader limited
to its own service, the session and that student. It returns
`[{ resultId, phaseId, questionId, component, payload, message, status,
publishedAt }]`. The registry drops each entry that is malformed, that cites a
result its reader did not return, or that moves a result to another phase or
question, then adds `serviceId` and orders the merged list by `publishedAt`. A
handler that fails, times out or returns something other than a list
contributes nothing and is logged; the others still answer.

The Argumentation Tutor subscribes (#1126). Its handler returns the student's
`completed` results whose `adapter_result` records the student as
`publishedToUserId`, each rebuilt from its `raw_payload` and its ids with the
function the live path publishes with, so an entry holds the `component`,
`payload`, `message` and `status` of the socket event, the event's
`resultId`, and the result's `receivedAt` as `publishedAt`. Failed results,
results whose handler never finished and results published to another
student are left out.

The contract and the reader are described in
`ethicapp/backend/external-services/README.md`, "Student results reading".

### Composing signal

The composing signal (epic #601, #654) tells a group that one of its members
or the activity's teacher is writing in its chat, and tells the chat's AI
services that a participant is still writing. It never carries draft text,
keys or input length, and it creates no job, chat message, database record or
callback. The server's names and timing are in
`ethicapp/backend/helpers/composing-signal.js`; ethicapp-student keeps its own
copy of the client timing.

Delivery is split across sub-issues of epic #601. #654 defines the contract
below, the author label helper and the ephemeral hook; the socket handlers
(#655, #1200), the clients (#656, #1007, #1200) and the Polyadic bridge
(#657) implement it.

**Socket event, client to server.** `chatComposing` on `/student`, and on
`/teacher` for the activity's teacher:

| Event | Payload |
| --- | --- |
| `chatComposing` | `{ phaseId, questionId, groupId, kind }`, with `kind` `"composing"` or `"stopped"` |

The server drops a payload with any other field and takes the writer from
`socket.data.uid`. On every signal, without caching, it checks that the
writer is a member of the group (or owns its session, for the teacher), that
the group belongs to the phase, and that the chat accepts messages: the
phase has chat, is the session's current phase and the session is in
progress, the rule of `POST /phases/:id/question/:question_id/chat_messages`.
A phase started by the deadline runner (#1105) closes the previous phase's
chat for the next signal. Each socket may send 20 signals per minute
(`helpers/sliding-window-throttle.js`); signals over the limit are dropped
silently.

**Group notice, server to clients.** `onChatComposing` to the room
`group-<groupId>` on `/student`, to every member but the writer:

| Event | Payload |
| --- | --- |
| `onChatComposing` | `{ groupId, questionId, userId, role, name, kind }` |

- `role` is `"A"` for a participant and `"P"` for the activity's teacher.
- `name` is resolved on the server by `chatAuthorLabel()`
  (`ethicapp/backend/helpers/chat-author-label.js`), with the rule of the
  student app's chat: the participant's first and last name (or their
  `name`), their `anon_mask` in an anonymous phase, or `null` when the
  client shows a translated label (the teacher, or an anonymous participant
  without a mask). A notice never carries a real name in an anonymous phase.
- A client shows `composing` for 10 s unless a newer notice arrives, and
  clears it at once on `stopped`. The activity's teacher's interface shows
  no indicator.

**Client timing,** the same for both clients:

- `composing` on the first edit, and again at most every 5 s while edits
  continue;
- `stopped` once on submit, blur, 8 s without edits, navigation or unmount,
  and only after a `composing`.

A client therefore sends at most 13 signals per minute. Without a working
socket the student app polls, and no notice can reach it.

**AI services.** Participants' signals, coalesced to at most one `composing`
per participant every 12 s, reach the `participant-activity` hook through
`registry.dispatchEphemeralHook()`. Its audience is the services subscribed
to the hook among those the phase enables (none when the activity was
launched with its AI services off) that the session's pinned policy version
allows, with a usable AI Additions connection. Each handler receives
`{ kind, sessionId, phaseId, questionId, groupId, userId, receivedAt,
ttlSeconds, serviceId }`, where `receivedAt` is the server's receipt time and
`ttlSeconds` defaults to 30. A receiver counts the participant as active
until `ttlSeconds` after the last `composing`, never past
`max(receivedAt) + ttlSeconds`, treats `stopped` as advisory, and uses the
signal only for its room-level inactivity. The teacher's signals never reach
the hook. The contract is described in
`ethicapp/backend/external-services/README.md`, "Ephemeral hooks".

**Single instance.** The notice reaches only the clients connected to the
same ethicapp instance, and the coalescing and the rate limit are kept in
memory. A deployment with several web instances would need a Socket.IO Redis
adapter, like the other single-instance assumptions of the phase deadline
runner and the Polyadic bridge.

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
| `correlationId` | No | The job UUID returned by EthicApp when the job was dispatched, or a room's room job id (`ethicapp_room_correlation_id`, #833). Without a matching job of the service, the callback is delivered only to a verified destination whose room is not bound (see above). |
| `eventId` | No | A UUID minted by the caller for this specific emission attempt. When provided, EthicApp uses `(serviceId, eventId)` as a deduplication key so that network retries of the same event are idempotent. Distinct `eventId` values on the same job are each processed independently. Omitting `eventId` falls back to terminal-state deduplication: any callback on a job that has already reached a terminal status is treated as a duplicate. |
| `payload` | No | Arbitrary service-specific data. |

The Bearer token must be a Keycloak `client_credentials` token issued to the
calling service's dedicated Keycloak client (for example `polyadic-agent-api` or
`argumentation-tutor-api`). EthicApp validates the JWT locally using the realm
JWKS, checks issuer, expiry, audience, and clock tolerance, and then authorizes
the caller against the per-service `callbackAuth` manifest entry.

The controller dispatches the `callback-received` hook with
`dispatchServiceHook(...)`, which selects only subscribers belonging to the target
service id, and decides where the callback may publish (#815):

- A callback whose `correlationId` matches a job of its service goes to the
  job's session, phase, question, group and user, even after the current policy
  removed the service. Its payload may not name another destination (`409`).
  A room job (#833) accepts repeated callbacks until its phase ends or its
  activity finishes, and is never completed by one; once closed, or once its
  phase is no longer the session's active phase, its callbacks answer `409`.
  The registry closes room jobs itself when it dispatches `phase-ended` or
  `activity-finished`, before the policy and connection gate, so they close
  even when no adapter receives the hook.
- A callback that matches no job (an older Polyadic's proactive interventions
  carry a fresh correlation id each time) is refused (`409`) when the room it
  names is bound to an open room job. Otherwise it is accepted only for the
  destination its payload names when the session's pinned policy version
  allows the adapter, the phase is the session's active phase and its design
  enables the adapter, and the group (or user) belongs to it. Otherwise `409`.
- A correlation id of another service's job answers `409`; a failed lookup
  answers `503`.
- Every callback is recorded `pending` and consumed by one conditional
  `UPDATE` right before its handlers run. Authorization writes nothing, so a
  `503` (even during a database outage) leaves the event pending: a retry with
  the same `eventId` is authorized and delivered again, exactly once (attempts
  that lose the claim get `202` as a duplicate). Delivered events and `409`
  refusals stay duplicates.

The handler receives that destination, not the request's values. See
`ethicapp/backend/external-services/README.md`, "Usability".

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
      // The stored callback this result comes from (#1126).
      resultId: context.resultId,
      documentSchema: "student-result/v1",
      document: {
        schemaVersion: "student-result/v1",
        locale: "en-US",
        title: "Feedback on your argument",
        sections: [{
          kind: "bullets",
          items: ["Your argument has a clear claim and one supporting reason."]
        }]
      }
    });
  });
}
```

The backend sends this payload to the student namespace through the
`onExternalServiceResult` websocket event. The current PoC targets a user room
named `user-{uid}`. The event is not stored or replayed: an adapter that
publishes from a callback rebuilds the result from the stored callback through
the `student-results-reading` hook (see "Student results reading").

`publishStudentResult` checks the document against its schema and the
service's declaration before it sends it; see "Student result documents".

An adapter that publishes from a `callback-received` handler adds
`resultId: context.resultId`, the id of the stored callback in
`external_service_results`, to its payload, and the event carries it
unchanged. The `student-results-reading` entries rebuilt from that callback
carry the same id, so the student app can show each result once whether it
arrived by the event or was loaded with the activity (#1128). The tutor
adapter sends it (#1126). The development mocks publish without a stored
callback and send none.

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

The agent row is shared by every agent of a service, and its display name is
the latest one published. A message published while a `callback-received`
handler runs is linked to that callback's `external_service_results` row
instead: the handler passes `resultId: context.resultId` to
`publishGroupChatMessage(...)`, and the message stores it in
`external_service_result_id` (#947). The activity reports read the agent of
each message, and the job the callback answered, from the linked result. See
`ethicapp/backend/external-services/README.md` ("Available Hook Publishers").

A service may name its agent differently in each room, as Polyadic does with
the guide's nickname or its locale default (#1026). The adapter passes that
name as the message's `authorName` and records it in its handler's result
(`publishedMessages[].displayName`); the agent row keeps the canonical name.
The live notification carries `authorName`, and the chat transcripts (the
group chat route for students and teachers, and the semantic differential
report's `name` column) read it from the linked result
(`ethicapp/backend/helpers/external-agent-author.js`). Messages published
before #1026, outside a callback, or from a result of an anonymized student,
whose strings the erasure redacts (V31), show the agent row's name.

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

The activity page also loads the published results from the student route
(see "Student results reading" in `ethicapp/backend/external-services/README.md`):
when the activity opens, after a phase transition, after the socket
reconnects (#1128) once the student's room is joined again (#1108), and from
the view's "Update activity" action (#626). It merges them with the socket events by `resultId`, so a
result shows once whichever source brings it first; an event without
`resultId` keeps an id made in the browser. A load never removes a result
already shown, the answer of an older load never replaces a newer one, and a
failed load leaves the page as it was. A response whose result was loaded
before its event shows no processing state. The pure logic lives next to the
page, under `ethicapp-student/frontend/src/pages/session-detail/`:
`externalServiceResults.js` (merge), `externalResultsLoading.js` (load
triggers and ordering) and `externalResultsExpansion.js` (collapsing).

The socket's rooms (session, student and group) are joined when the activity
opens and again after every reconnect, since the server forgets a dropped
connection's rooms (`activitySocketRooms.js`, #1108). While the socket is
down, `realtimeFallback.js` keeps the view current (#626): it shows a notice
once the outage lasts 8 seconds, probes the activity every 15, 30 and then 60
seconds (±20%) and when the page becomes visible or focused, reloads it when
the probe sees a new status or phase, and reloads it again on reconnect. The
probe reads the activity's descriptor and the cached `full_state`, which the
server flushes when a phase starts or the activity ends, so it flushes no
cache itself. The "Update activity" button updates the activity on demand,
for students who cannot reload the page, as inside an LMS iframe. It probes
first and flushes the server's caches only when the status or phase changed
(those caches are shared by the session's students), then stays disabled for
10 seconds saying the activity is up to date (3 seconds after a failure), so
repeated clicks cost one update. A failed reload keeps the activity on
screen. The Socket.IO client keeps retrying, at most once every 30 seconds
(±50%).

Each phase tab shows its own results, newest first. The newest result of the
current phase is expanded and the others are collapsed; the student can
expand or collapse any of them with its header button. Results cannot be
dismissed, and the expanded state is page state only, so a reload starts
from the defaults again.

Each result names its document schema in its `component`, as
`{ "documentSchema": "student-result/v1" }`, and the student app renders it
with its own renderer for that schema, the generic one for
`student-result/v1` (see "Student result documents"). The student app loads
no code from a service. Until the tutor adapter publishes documents (#1133),
the panel also resolves the tutor's legacy `componentId` against a local
registry.

## Student result documents

A result that an AI service shows to a student is a `student-result/v1`
document (epic #1124). The service writes it, EthicApp checks it against the
schema and against the service's declaration, and the student app renders it
with its own code, chosen by the document's schema. A new service with output
for students therefore needs no change in the student app, and the student
app loads no code from services.

ethicapp-ai-additions owns the contract: the schema is
`shared/schemas/student-result.v1.schema.json` in that repository (JSON Schema
draft 2020-12, `$id`
`https://github.com/EthicApp-Development/ethicapp-ai-additions/schemas/student-result/v1`),
and its `README.md` explains it in the "Student Result Document" section.
EthicApp keeps a verbatim copy of the schema and its examples in
[`canonical-schemas/ai-additions/`](canonical-schemas/ai-additions/README.md),
whose README names the commit it was copied from and how to update it.
`npm run test:schemas` validates the examples against the copy. The examples
include the Argumentation Tutor's analysis and comparison in both locales, a
minimal document and a document with a section of an unknown kind.

### Document fields

| Key | Required | Format | Meaning |
| --- | --- | --- | --- |
| `schemaVersion` | yes | `"student-result/v1"` | The schema of the document. |
| `locale` | yes | `es-CL` or `en-US` | Language of every text in the document. |
| `title` | yes | single-line plain text, up to 120 characters | Heading of the result. It never names the service (#591). |
| `summary` | no | plain text, up to 2,000 characters | Short message under the title. |
| `overview` | no | Markdown subset, up to 4,000 characters | How the service evaluated the student's work, shown as help above the sections. |
| `status` | no | `complete`, `partial` or `unavailable` | `complete` (the default) when the document holds the whole result; `partial` when some parts could not be produced and the texts say which; `unavailable` when the service could not produce the result and `summary` says so. |
| `sections` | yes | up to 20 sections | The body, rendered in order. It may be empty. |

Each section has a `kind`, an optional `title` (single-line plain text, up to
120 characters) and the fields of its kind:

| Kind | Fields | Rendering |
| --- | --- | --- |
| `criteria` | `items`: 1 to 12 criteria, each with `key` (`^[a-z][a-z0-9_-]*$`, up to 64 characters, unique in the section, never shown), `label` (single line, up to 80), `value` (single line, up to 120) and optionally `score`, `minScore`, `maxScore` (numbers) and `description` (Markdown subset, up to 2,000). | The label and value of each criterion. A criterion with a `description` opens it on demand. |
| `bullets` | `items`: 1 to 12 plain-text strings, up to 1,000 characters each. | A bulleted list. |
| `text` | `text`: plain text, up to 10,000 characters. | A block of text, such as the student's own answer. |
| `comparison` | `items`: 1 to 12 items, each with `label` (single line, up to 80), `before` and `after` (plain text, up to 500 each), and optionally `key` (the key of the criterion it compares) and `trend` (`improved`, `unchanged` or `declined`). | Each label with its earlier and later result, styled by `trend` when present. |

A criterion's `value`, such as `2 of 3` or `Against`, is what the student
always sees, and it makes sense alone. `score`, `minScore` and `maxScore` let
a renderer draw a meter: `maxScore` requires `score`, `minScore` requires
`maxScore` and defaults to `0`. Two rules are beyond JSON Schema: criterion
keys are unique within a section, and a criterion with `maxScore` has
`minScore < maxScore` and `minScore <= score <= maxScore`. Services check them
with `ethicapp_ai_capabilities.validate_student_result()` before publishing.
The schema copy in EthicApp does not express them, so the backend checks them
next to the schema, with the same codes (`duplicate_criterion_key`,
`score_out_of_range`), and both sides refuse the same documents.

### Text formats

Every text is plain text except `overview` and a criterion's `description`,
which use a Markdown subset.

- **Plain text:** shown character for character, with no markup interpreted,
  so `**`, `<b>` or `&amp;` appear literally. A line feed is a line break.
  Required texts contain at least one character other than whitespace.
- **Single-line plain text** (`title`, section titles, labels, criterion
  values): plain text without carriage returns or line feeds.
- **Markdown subset:** paragraphs separated by a blank line, a single line
  feed as a line break, `**bold**` and `*italics*`, bulleted lists (`- `) and
  numbered lists (`1. `) one level deep, and backslash escapes of ASCII
  punctuation. Headings, links, autolinks, images, code, blockquotes, tables,
  horizontal rules, HTML tags and entities show as plain text. In the student
  app, which already depends on `markdown-it`, the subset is
  `markdownit('zero', { breaks: true }).enable(['list', 'emphasis', 'newline', 'escape'])`,
  with `html`, `linkify` and `typographer` off.

The service writes every text in the activity's language: EthicApp sends the
activity's locale with each request, and `locale` records the language of the
answer (`es-CL` for EthicApp's `es_CL`, `en-US` for `en_US`). Renderers mark
the document with that language (the HTML `lang` attribute) and write their
own interface text inside the document, such as the label of the control
that opens a description, in that language too, so the student reads one
result in one language (#1169). A document without a supported `locale` gets
that text in the student app's language. Text around the document, such as
the result panel's controls, stays in the student app's language.

### Strict objects and the extension point

The document, the sections of the four known kinds and their items are
closed (`additionalProperties: false`). A key the schema does not define makes
the document invalid. This catches misspelled keys and keeps data meant for
teachers, such as the tutor's `claimTypeId`, `tutorMode` or `evidenceFactIds`,
out of the student's browser.

A section of any other kind needs only a `kind` in kebab case
(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`): the schema accepts it with any other fields
and renderers skip it. Unknown section kinds are the only extension point of
v1. A later revision of the schema can add a kind, and older renderers keep
showing the rest of the document. Every other addition (a key, a locale, a
`status` value, a looser limit) is a schema change that reaches EthicApp's
copy before a service emits it, and a change that makes a valid v1 document
invalid needs `student-result/v2`.

### Student output declaration

A service declares the documents it publishes to students in the optional
`student_outputs` array of its capability descriptor
(`shared/schemas/capability-descriptor.v1.schema.json` in
ethicapp-ai-additions; the descriptor's `contract_version` stays `"1"`):

```json
"student_outputs": [
  {
    "id": "argument-feedback",
    "document_schema": "student-result/v1",
    "scopes": ["response"],
    "display": {
      "label": "Argument feedback",
      "description": "Feedback on each argument a student submits."
    }
  }
]
```

- `id`: stable identifier in kebab case, up to 64 characters, unique in the
  descriptor.
- `document_schema`: the schema of the documents, `student-result/v1`.
- `scopes`: the manifest scopes in which the documents reach students, one or
  more of `response` and `chat`. The `case` and `design` scopes serve teachers
  and are outside the declaration.
- `display.label` and `display.description`: text for teachers and operators,
  localized like field labels.

The declaration is a validation contract: EthicApp refuses a document whose
schema the service did not declare for the scope it is published in. A
descriptor without `student_outputs` declares no output. Unknown keys inside
an entry are ignored, as elsewhere in the descriptor.

A development adapter (`development: true` in
`ethicapp/backend/external-services/manifest.json`) requires no AI Additions
service and links no descriptor, so it declares its outputs in its catalog
entry (#1134), in the normalized form of the entries above:

```json
"studentOutputs": [
  {
    "id": "mock-review",
    "documentSchema": "student-result/v1",
    "scopes": ["response"],
    "label": "Mock review",
    "description": "Development review of each response a student submits."
  }
]
```

EthicApp reads that declaration only for a service that links no
descriptor. A production adapter that declares `studentOutputs` rejects the
catalog at startup: a production service's declaration is the one its
descriptor publishes. `ethicapp/backend/external-services/README.md`,
"Student result documents", has the validation rules.

### Publishing a document

An adapter publishes a document through `publishStudentResult(...)`, which
emits it to the student as `component: { documentSchema: "student-result/v1" }`
with the document as `payload`. The socket event and the entries the
`student-results-reading` hook rebuilds carry the same pair:

```json
{
  "resultId": "3f0c9a52-6b1e-4d2a-9c4e-2f5b8e7d1a90",
  "component": { "documentSchema": "student-result/v1" },
  "payload": {
    "schemaVersion": "student-result/v1",
    "locale": "en-US",
    "title": "Feedback on your response",
    "sections": [{ "kind": "text", "text": "Your response was received and reviewed." }]
  }
}
```

The backend enforces this contract (#1131):

- `publishStudentResult` accepts `{ documentSchema, document }` next to the
  ids, and emits the pair above with those ids only;
- the document must validate against the copy in
  `canonical-schemas/ai-additions/` and its two integrity rules, and the
  service must declare its schema in `student_outputs` for the scope the
  document is published in. `publishStudentResult` and the
  `student-results-reading` hook publish in the `response` scope; `chat` is
  reserved for documents shown in a group chat, which no publisher emits yet;
- a document that fails either check is logged, with ids, codes and paths
  only, and not published, and results rebuilt through
  `student-results-reading` go through the same checks;
- a live publication refreshes the service's declaration when the cached one
  is older than ten minutes. A rebuild never waits for the service: it uses
  the last declaration the process fetched, which survives an outage and a
  change of the AI Additions connection, and refreshes it in the background.
  Until the process has fetched the service's descriptor once, its documents
  are refused;
- a development adapter, which links no descriptor, is checked against the
  `studentOutputs` of its catalog entry (see "Student output declaration");
  the development mock publishes its documents that way (#1134);
- the `component` path of the legacy result descriptor keeps working until
  the tutor adapter publishes documents (#1133).

`ethicapp/backend/external-services/README.md`, "Student result documents",
describes the argument, the checks and their log lines.

### Rendering in the student app

The student app (#1132) renders `student-result/v1` with one generic
renderer: the title, summary and status, the overview above the sections, and
each known section kind in order. Sections of an unknown kind are skipped. A
criterion with a `description` has a help control that opens the description
next to the criterion on a tap, a click, Enter or Space, and closes it with
the same control or Escape; it works without hover at 360 px and announces
its state to screen readers. The overview and descriptions go through the
restricted `markdown-it` setup above, and every other field is rendered as
text.

The result panel resolves the renderer from `component.documentSchema`
through an allowlist in the student app's code, where `student-result/v1`
maps to the generic renderer. During the transition it then tries the legacy
`componentId` registry. A result whose schema is not in the allowlist shows a
neutral notice. The renderer is chosen by the document's schema alone, so the
student cannot tell which service produced a result (#591).

### Adding a specialized renderer

A service whose results need a view that the generic renderer cannot give
gets a renderer in the student app's allowlist, keyed by a document schema.
The student app never loads code from a service, so the renderer is student
app code, reviewed and released with EthicApp.

First check whether a new section kind of `student-result/v1` is enough. A
kind is added to the schema in ethicapp-ai-additions, copied here, and taught
to the generic renderer; older renderers skip it, so every service can use
it. A separate document schema is for results whose shape differs from a
titled list of sections.

To add a renderer for a new document schema, such as `<name>/v1`:

1. Define the schema and its examples in ethicapp-ai-additions
   `shared/schemas/`, explain it in that repository's README, and add the
   schema's name to the `document_schema` values that
   `capability-descriptor.v1.schema.json` accepts in `student_outputs`.
2. Copy the schema and its examples into `canonical-schemas/ai-additions/`
   with the steps of its README, and add a schema test like
   `canonical-schemas/__tests__/student-result-v1.schema.node-test.mjs`.
3. Add the schema to `DOCUMENT_SCHEMAS` in
   `ethicapp/backend/services/student-result-documents.js`, with its
   integrity rules, so its documents are checked against the copy and are not
   refused as unknown.
4. Write the renderer component in the student app, add an entry for the
   schema to the allowlist in
   `ethicapp-student/frontend/src/components/session-detail/external-services/resultRenderers.js`,
   and map the renderer id to the component in `ExternalServiceResultPanel.jsx`
   next to it. The renderer treats every text as plain text
   except the fields its schema marks as Markdown, which go through the
   restricted `markdown-it` setup; it sets `lang` from the document's
   `locale`, writes its interface text through the student app's locales in
   the document's language (`resultLabelLocale` in `studentResultDocument.js`),
   and inserts no HTML from the document.
5. Cover the renderer with node tests that render the copied examples,
   including their Markdown and their unknown parts, and add screenshots at
   360 px and 1366 px in both locales to the pull request.
6. Declare the schema in the service's `student_outputs`, and only then
   publish documents of it.

Removing a renderer from the allowlist makes the results of that schema show
the neutral notice, including results rebuilt from earlier callbacks.

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
- Adapter payload sanitization is service-specific and intentionally minimal in
  the mock adapter.

## Recommended Next Steps

- Define adapter capability metadata for teacher-facing configuration beyond a
  simple enabled/disabled checkbox.
- Add integration tests for service loading, hook dispatch filtering, callback
  routing, and mismatched `serviceId` rejection.
