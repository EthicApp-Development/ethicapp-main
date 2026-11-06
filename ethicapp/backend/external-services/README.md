# External Services

This directory contains EthicApp backend adapters for optional external AI services.
Adapters are loaded through `manifest.json` and are executed by the external services
registry in `../services/external-services.service.js`.

The current production-oriented contract is that EthicApp owns authentication to
`ethicapp-ai-additions`. Individual adapters should call AI services through the
shared AI Additions client instead of negotiating Keycloak tokens themselves.

## Runtime Model

At startup, the registry reads `manifest.json` from this directory: the
adapter catalog (#812).

### The adapter catalog

`manifest.json` lists the adapters EthicApp ships. It is code, not deployment
configuration: there is one catalog for every environment, no `enabled` flag
and no variable to choose another file. `catalog.js` validates it, and an
invalid catalog stops startup (and the image build, through
`__tests__/manifest.node-test.mjs` and `__tests__/catalog.node-test.mjs`).

- **Production adapters** declare the AI Additions services they require
  (`requires`). All of them register at startup.
- **Development adapters** (`development: true`) are the mocks. They talk to
  `external-mock-service` or run in process, require no AI Additions service
  (`requires: []`), and register only when
  `EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true`. Only the root
  `docker-compose.yml` sets it. Since they link no capability descriptor,
  they declare the documents they publish to students in their entry
  (`studentOutputs`, see "Student result documents").

Registering only subscribes handlers: it makes no outbound call
(`__tests__/registration.node-test.mjs`). Whether a registered adapter
receives events is decided at dispatch, by the registry's policy gate (see
"Usability").

### Usability: the AI service policy gate

`registry.effectiveServiceIds(requestedIds, policyVersion)` is the one place
that decides whether an adapter may receive events (#815, epic #810):

- **Production adapters** pass when every AI Additions service in their
  `requires` is in `policyVersion.allowedServiceIds`, their own id is not in
  `policyVersion.disabledAdapterIds`, and a usable AI Additions connection is
  stored. "Usable" means a row exists and its URLs are valid
  (`isValidAiAdditionsUrl` in `helpers/ai-additions-connection.js`; see
  "Stored connection URLs" below). The connection is read through the AI
  Additions client (`isConfigured()`, 5 s cache), and a failed read counts as
  no connection.
- **Development adapters** (the mocks, `requires: []`) need no AI Additions
  service, so they pass whenever they are registered, which only happens with
  `EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true`, whatever the policy or the
  connection. Production installations never register them.

**Switching adapters off (#864, epic #861).** Allowing an AI Additions service
enables every adapter that requires it: allowing `case-analyst` enables three
case analyses (`case-analyst-evaluation`, `case-analyst-evidence-inventory`,
`case-analyst-topic-listing`) and one design analysis
(`case-analyst-claim-typology`). A policy version can switch individual
adapters of its allowed services off, in `disabled_adapter_ids` (V26; the
store maps it to `disabledAdapterIds`). Switching the claim typology off stops
design analyses while the case analyses keep running, and the other way round.
Every listing and dispatch goes through `isAllowedByPolicy()`, so the case
form, the design editor, design-analysis dispatch, descriptor lookups,
callbacks without a job and the claim typology's own tutor check all see the
switch. Versions saved before V26 switch nothing off. The management console
lists each service's adapters grouped by scope, with a switch for each
(`GET /api/admin/ai-services/catalog` returns their scopes and localized
labels).

Which version applies:

| Path | Version |
| --- | --- |
| Session hooks (`phase-started`, `phase-ended`, `activity-started`, `activity-finished`, `student-response-submitted`, `chat-message-received`, and any hook other than `case-created`, `design-created` and `design-updated`) | The version the session was pinned to at launch (`sessions.ai_service_policy_version_id`), found from `context.sessionId`. A hook without `sessionId` follows no version. |
| `case-created` (`NON_SESSION_HOOKS`) | The current version. It only bounds the author's choice (`case_analyses`), made when the case is created or later from the case view (`POST /cases/:id/analyses`, #1039): the candidates are the services chosen for the case, never every allowed one. |
| `user-forgotten` (`NON_SESSION_HOOKS`, `ERASURE_HOOKS`) | None: erasure hooks skip the policy and only need the AI Additions connection. |
| `design-created` and `design-updated` (`NON_SESSION_HOOKS`) | The current version. Only the reserved design analyses receive them (see "Design Analyses"). |
| `GET /external-services`, `GET /external-services/:id/instance-configuration`, design saving, the case form's choice (`POST /cases`), adding services to a case (`POST /cases/:id/analyses`), regenerating a case or design analysis | The current version. |
| The student activity descriptor | The session's pinned version. |
| Callbacks | See below. |

`dispatchHook` resolves the version itself (`resolveHookPolicyVersion`), so
callers keep passing only the ids their design or case enables. The version is
read only when a production adapter is among them. A launched session's pin
never changes, so `getSessionPolicyVersionId` caches it per session, and
versions are immutable, so `getPolicyVersion` caches them too. A policy that
cannot be read allows no production adapter.

Designs keep the ids of services that are not usable; nothing is dispatched to
them. Saving a design that enables one answers with a `not_allowed` warning for
it, and launching an activity lists them in `servicesNotRunning` (shown to the
teacher as a notice on the activity dashboard). Neither is an error.

Callbacks are the one exception to the gate. `POST /external-services/callbacks`
decides the destination of each callback in `dispatchServiceHook`, and hands it
to the handler as trusted context (`sessionId`, `phaseId`, `questionId`,
`groupId`, `userId`, plus `context.job` or `context.callbackDestination`),
never the request's own values:

1. **The callback matches a job of its service** (`correlationId`). It goes to
   that job's destination, whatever the current policy allows, so work started
   earlier can finish after its service is removed. The destination its payload
   names (the adapter's `getCallbackTarget(requestPayload)`) must stay inside
   the job (`assertCallbackTargetWithinJob`): a field it names must equal the
   job's, and a job without that field accepts none. Otherwise `409`. A
   **room job** (see "Room jobs" below) accepts repeated callbacks while it is
   `pending` or `open` and its phase is still the session's active phase; a
   closed or failed one, or one whose phase is over, refuses them with `409`
   (`callback_room_job_closed`).
2. **The callback matches no job** (no correlation id, or a fresh one: an
   older Polyadic generates a new one for every proactive intervention, such
   as session start, timer ticks, inactivity or window events). If the room it
   names is **bound** (it has an open room job whose id Polyadic acknowledged),
   it is refused with `409` (`callback_room_bound`): that room's callbacks must
   carry its job. Otherwise it is accepted only when
   `resolveCallbackDestination()` (`helpers/callback-destination.js`) verifies
   the destination the payload names:
   - the adapter exports `getCallbackTarget` and names a complete target: a
     session and a phase, plus the group or the user when its target has them;
   - the destination session's **pinned** policy version allows the adapter
     (never the current version), and a connection exists for production
     adapters;
   - the session was launched, the phase is its current phase and the activity
     is in progress;
   - the phase's design (the locked design, `getPhaseExternalServices`, as for
     phase hooks) enables the adapter;
   - the group belongs to that phase (`teams`), and the user takes part in the
     session (`sesusers`).

   Otherwise `409`. The verified destination has no `questionId`; Polyadic
   resolves it from the phase.
3. A correlation id of **another service's job** is refused with `409`. A
   failed lookup (the result or job, the pinned version, the connection, the
   phase state, the design or the room's room jobs) answers `503`, so the
   caller may retry. Without a
   connection the middleware already answers `503 not_configured`.

No handler runs when a callback is refused. Development adapters follow the
same rules (they need no connection, as for dispatch); the mocks never receive
HTTP callbacks.

**Result states** (`external_service_results.status`,
`V23__external_service_results_pending.sql`):

| Step | Write | Status |
| --- | --- | --- |
| Receipt (`createResult`) | Insert, nothing else | `pending`: received, not consumed |
| Authorization (correlation, target, destination, policy) | None | stays `pending` |
| Transient refusal (`503`) | None | stays `pending` |
| Refusal (`409`), including a closed room job or a bound room without a job | Best effort | `failed`; if the write fails, it stays `pending` and a retry is refused again |
| Claim (`claimResult`), right before handlers | `UPDATE … WHERE id = $1 AND status = 'pending'`, then a hook job is advanced to `callback-received`. For a room job, the same statement also requires the job to be still `pending` or `open`, and the job is not advanced | `callback-received` (job matched) or `unknown-correlation` |
| Claim refused because the room job closed after authorization | Best effort | `409`, `failed` |
| Handler outcome | As before; a room job's status is never changed | `completed` or `failed` |

Recovery never depends on a write made during an outage: until the claim, the
event is unconsumed, and a retry with the same `eventId` is authorized again.
Only one attempt can claim it; the others get the duplicate answer. A failed
claim answers `503` and leaves it pending. Delivery is at most once from the
claim on: a crash after the claim leaves the event consumed.

Targets per adapter:
- Polyadic: the room `ethicapp-s<session>-p<phase>-g<group>`.
- Argumentation Tutor and the mock response review: the `sessionId`,
  `phaseId`, `questionId` and `userId` their feedback is published to.
- Case Analyst (case evaluation and evidence inventory): none. Their handlers
  only record the result in the job's case analysis, so they only accept
  callbacks for their jobs.

### Room jobs

A room job (#833, `V24__external_service_room_jobs.sql`) binds a room's
proactive callbacks to a job EthicApp created for that room. It is a row of
`external_service_jobs` with `kind = 'room'` (every other job has
`kind = 'hook'`), for one room: service, session, phase and group. Its id is
the room's correlation id. Adapters reach them through the `roomJobs` argument
of `register()` (`services/external-service-room-jobs.service.js`).

| Status | When | Callbacks with its id |
| --- | --- | --- |
| `pending` | Created right before the room is created in the service | Accepted (the service may call back before it answers) |
| `open` | The room exists. `room_bound` is true when the service echoed the id | Accepted, each deduplicated by `eventId`; a callback outcome never completes the job |
| `closed` | `phase-ended` for its phase, `activity-finished` for its session, a newer room job of the same room opened (superseded), or a callback found its phase no longer active | `409` |
| `failed` | The room could not be created | `409` |

**Closing is the platform's, not the adapter's.** `dispatchHook()` closes the
live room jobs of every service for `phase-ended` (its phase) and
`activity-finished` (every phase of the session) as its first step
(`closeRoomJobsForHook`), before the policy and connection gate and whether or
not any adapter receives the hook. It is local and reads only the database, so
it works without an AI Additions connection and after a restart, and it is
idempotent. Outbound calls (closing the Polyadic rooms) stay in the adapters,
behind the gate. `dispatchPhaseHook()` and the activity-finished dispatch hand
these two hooks to the registry even when no service is enabled or the design
cannot be read.

**Phase check (defense in depth).** A callback matched to a live room job is
also checked against the phase state (`loadPhaseState`, as in
`helpers/callback-destination.js`): the job's phase must still be the
session's current phase, and the activity in progress. Otherwise it answers
`409` (`callback_room_job_closed`) and the job is closed, on a best-effort
basis. A failed read answers `503` and leaves the result pending.

Polyadic:
- `phase-started` creates one room job per room and sends its id as the
  top-level `ethicapp_room_correlation_id` of `POST /rooms/:room/sessions`
  (also on the retry without configured settings). A room created lazily by
  `chat-message-received`, for example after a restart, gets a new room job
  that supersedes the previous one. Concurrent creations of one room in a
  process share one room job and one request.
- When Polyadic echoes the same `ethicapp_room_correlation_id` in its
  response, the room is **bound**: a callback that carries no job and names
  it is refused (`409`). An older Polyadic does not echo the field; its rooms
  stay unbound and keep the verified-destination rule above. Either release
  can therefore ship first.

Every room job write is one statement conditional on the job's status, so a
phase transition and a re-creation racing each other never reopen a closed
job. If a room job cannot be created, the room is created without an id, as
before; if it cannot be opened, it stays `pending` (still accepting
callbacks) and the room stays unbound.

Residual risk: a callback without a job that names an **unbound** room is still
accepted under the verified-destination rule, so a Polyadic client that holds
valid credentials can name another unbound room whose session allows Polyadic,
whose phase is active and enables it, and whose group exists. Once every
Polyadic acknowledges the id, callbacks without a job can be refused for
Polyadic altogether.

The editor does not offer services that are not usable (#686), so seeded
activities that reference the mocks still load where the mocks are not
registered.

### Stored connection URLs

The management console only saves valid URLs, but rows inserted by hand bypass
it, and the database CHECK only requires `^https?://`. EthicApp applies the
console's rule (#834): after trimming surrounding whitespace, the value must
match `^https?://([^/?#@\\\s]+)(/[^?#\\\s]*)?$` (case-insensitive), have no `.`
or `..` path segment, be at most 2048 characters long and parse with a
non-empty host. Path prefixes and trailing slashes are allowed. A `base_url` or
`keycloak_public_url` that breaks the rule counts as no connection: the AI
Additions client rejects every call with `not_configured` before sending
anything, callbacks answer `503 not_configured`, and the gate lets no
production adapter through. The boundary cases both implementations pass are in
`canonical-schemas/ai-additions-connection/url-cases.json`.

Every service declares `callbackAuth`. The mock adapters never receive HTTP
callbacks (they call the mock service synchronously), so they accept only
`ethicapp-external-mock`, a client id that no environment provisions.

### Manifest entries

Each manifest entry describes one service:

```json
{
  "id": "argumentation-tutor-system",
  "description": "Human-readable description.",
  "adapter": "./adapters/ats-feedback.adapter.js",
  "hooks": ["student-response-submitted", "phase-ended", "callback-received"],
  "globalHooks": [],
  "requires": ["argumentation-tutor"],
  "scopes": ["response"],
  "descriptor": {
    "path": "/argumentation-tutor/api/capabilities"
  },
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
| `requires` | yes | The AI Additions services the adapter talks to, by AI Additions id: `polyadic-agent`, `argumentation-tutor` or `case-analyst` (`AI_ADDITIONS_SERVICE_IDS` in `catalog.js`, the only list of them). A missing `requires`, an unknown or repeated id, or an empty list on a production adapter rejects the catalog. The service policy (#815) allows an adapter only when it allows all of them. |
| `development` | no | `true` marks a development-only adapter (the mocks). It must declare `requires: []` and registers only with `EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true`. Defaults to `false`. |
| `description` | no | Defaults to an empty string. The texts meant for case screens come from the adapter instead (see "UI translations"). |
| `hooks` | no | Declarative list of the hooks the adapter subscribes to. Non-kebab-case names are dropped with a warning. The registry does not enforce that `subscribe()` calls match this list; it is exposed through `GET /external-services` for operators and the teacher UI, so keep it in sync with the adapter. |
| `globalHooks` | no | Hooks the service opts into at manifest level, without an activity-design opt-in. Defaults to `[]`. Each name must be kebab-case and must also appear in `hooks`; other entries are dropped with a warning and duplicates are removed. Only consulted by `dispatchGlobalHook()` (see "Hook enablement"). Exposed through `GET /external-services`. |
| `scopes` | no | Where the service operates: `case` (case documents), `design` (activity designs, see "Design Analyses"), `response` (student responses) or `chat` (group chat). Defaults to `[]`. Unknown values are dropped with a warning and duplicates are removed. Screens list services by scope (see "Listing services"), so an entry without scopes appears in none of them; `__tests__/manifest.node-test.mjs` requires at least one. |
| `ui` | no | `{ component }`: the kebab-case name of the EthicApp frontend component that shows the service's analysis in its case view tab (see "Case view tabs"). Defaults to `{ component: null }`; other names are dropped with a warning. The texts come from the adapter, not from the manifest (see "UI translations"). |
| `produces` | no | The design analyses the adapter produces, as `[{ documentSchema, unit }]`, for example `[{ "documentSchema": "claim-typology/v1", "unit": "question" }]`. `documentSchema` is a kebab-case name with its major version (`<name>/v<major>`); `unit` is one of `DESIGN_ANALYSIS_UNITS` in `catalog.js` (only `question` so far). A producer needs the `design` scope. A malformed list, an unknown key or unit, or a repeated pair rejects the catalog. See "Producers, consumers and units". |
| `consumes` | no | The design analyses the adapter needs, in the same form as `produces`. Its phases decide which units the producer analyses. A consumption that no catalog entry produces for the same unit logs a warning at startup (`catalogWarnings()`), so a consumer can ship before its producer. |
| `descriptor` | no | `{ path }`: the capability descriptor the service's AI backend publishes (#687). Its id (`service.id` in the descriptor) is the one AI Additions service in `requires`, so an adapter with a descriptor requires exactly one service; `descriptor.serviceId` is no longer accepted (#812). That id may differ from `id`: ids are mapped, not renamed, so stored designs, chat agents and jobs keep the manifest id. `path` is the descriptor route relative to the AI Additions connection's `base_url`, for example `/polyadic-agent/api/capabilities`; it must be an absolute path without host, query or `..` segments. An invalid path is dropped with a warning. `GET /external-services` exposes `descriptor.serviceId` and a summary (see "Listing services"); the route stays internal (`getServiceDescriptor()`). |
| `capabilities` | — | Removed (#726). Entries that still declare it log a deprecation warning and the key is ignored. A service that processes student responses declares the `response` scope instead; the student app shows the processing state for those services. |
| `enabled` | — | Removed (#812). An entry that declares it rejects the catalog; usability is decided at dispatch (see "Usability"). |
| `studentOutputs` | no | Development adapters only (#1134): the documents the adapter publishes to students, as `[{ id, documentSchema, scopes, label, description }]`, the shape a capability descriptor's `student_outputs` takes once normalized. Each entry goes through the descriptor's normalizer, and its scopes must be among the entry's `scopes`. The key on a production adapter, a malformed list or entry, an unknown key or scope, or a repeated id rejects the catalog. Absent means none. See "Student result documents". |
| `report` | no | `{ columnPrefix }`: the prefix of every column the adapter adds to activity reports (see "Report building"), lowercase letters and digits ending in `_`, such as `ats_`. Required when `hooks` lists `report-building`; two entries cannot declare the same prefix. A malformed declaration, or `report-building` without one, rejects the catalog. |
| `callbackAuth` | no | Inbound callback authorization. See below. |

When `callbackAuth` is present, EthicApp verifies that the authenticated Keycloak
`azp` claim is in `allowedClientIds` and that any `requiredRoles` appear in the
token's `realm_access.roles` before dispatching `callback-received`.

### Adapter registration

For each registered service (every production adapter, and the development ones
when `EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true`), the registry imports the
adapter module and calls its `register()` function once at startup. Importing
and registering must make no outbound call and open no connection: defer such
work to the hook handlers. The function must be a named export
(`export async function register(...)`); a `default.register` property is also
accepted as a fallback. Modules without a callable `register` are skipped with a
warning and never receive hooks.

```js
export async function register({
    service,                 // normalized manifest entry (id, description, hooks, globalHooks, scopes, ui, descriptor, requires, report, development, adapter, callbackAuth)
    subscribe,               // (hookName, handler) => void
    publishStudentResult,    // (payload) => Promise<boolean>; see "Student result documents"
    publishGroupChatMessage, // (payload) => Promise<{ savedMessage, notificationPayload } | null>
    aiAdditionsClient,       // shared AI Additions HTTP client
    caseAnalyses,            // markProcessing/complete/fail for this service's case analyses
    designAnalyses,          // markProcessing/complete/fail for this service's design analyses
    roomJobs,                // create/open/fail for this service's room jobs (see "Room jobs")
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

Adapters may also export pure helpers for testing; only `register` and the
optional `getUiTranslations` (see "UI translations"),
`validateCaseAnalysisDocument` (see "Case Analyses"),
`validateDesignAnalysisDocument` and `designAnalysisInput` (see "Design
Analyses") are part of the registry contract. The adapter should subscribe only to hooks it handles.

Hook names are part of the adapter interface and must use kebab-case
(`/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`). Subscriptions and manifest entries with
other names are ignored with a warning.

### UI translations

Each service owns the texts teachers read about it, and its adapter obtains
them. An adapter may export `getUiTranslations()`:

```js
export async function getUiTranslations() {
    return {
        es_CL: { label: "Analista de casos", description: "...", tabTitle: "Retroalimentación del caso" },
        en_US: { label: "Case Analyst", description: "...", tabTitle: "Case feedback" },
    };
}
```

- Both UI locales, `es_CL` and `en_US` (see the i18n policy in `AGENTS.md`),
  need a non-empty `label` and `description`. `tabTitle`, the title of the
  service's tab in the case view, is optional and becomes `null` when missing.
  Texts are trimmed; other locales and keys are dropped.
- When the service publishes its own texts, the adapter asks the service for
  them, for example through `aiAdditionsClient`. Otherwise it returns
  constants, as `case-analyst-evaluation` does until Case Analyst publishes them.
- The registry calls it through `getServiceUiTranslations(serviceId)` with a
  3 s timeout. Valid texts are kept in memory for ten minutes. After a timeout,
  an error or an invalid result, it logs a warning and keeps the previous texts
  (or `null`) for a minute before asking again, so an unavailable service does
  not slow down every listing. Nothing is stored in Redis.
- At startup, a case-scoped service whose adapter does not export it is
  reported with a warning; case screens will fall back to its id.
  `__tests__/manifest.node-test.mjs` requires every case-scoped manifest entry
  to provide valid translations.

### Capability descriptors

`services/capability-descriptors.service.js` fetches the capability descriptor a
service links with `descriptor` (#687, #727) and returns the settings EthicApp
may store per activity. Callers use the registry:

```js
const configuration = await externalServicesRegistry
    .getServiceInstanceConfiguration("polyadic-devils-advocate", "es_CL");
```

- **Result.** `null` for unknown or disabled services and for services without a
  descriptor. Otherwise `{ available: true, stale, descriptorServiceId, name,
  usesLlm, locale, fields, studentOutputs }`, or `{ available: false, reason }` with `reason`
  `not_configured` (no AI Additions connection is stored; nothing is requested),
  `unreachable` (network error, timeout, HTTP error, or the connection cannot be
  read), `invalid_descriptor`, `unsupported_contract_version` or
  `service_id_mismatch`. It never throws, and it never touches stored
  configurations. Cached descriptors are keyed by the connection, so they are
  dropped when the operator changes or removes it.
- **Fetching.** `GET descriptor.path` through `aiAdditionsClient.requestJson`
  (Keycloak token, one retry after `401`) with a 5 s timeout and
  `Accept-Language`: `es-CL` for Spanish locales, `en-US` otherwise. Until
  ethicapp-ai-additions#180 lands, the services answer in English.
- **Validation.** A hand-written check equivalent to
  `shared/schemas/capability-descriptor.v1.schema.json` in ethicapp-ai-additions:
  `contract_version` must be `"1"` and `service.id` must equal
  `descriptor.serviceId`. Unknown keys are ignored. An unusable or repeated
  instance field is dropped with a warning instead of rejecting the descriptor.
  `runtime_configuration` is checked but never returned: it belongs to the
  service.
- **Fields.** Each field is normalized to `{ key, type, required, default,
  label, description, group, order, status, supersededBy, validation }`.
  `validation` depends on the type: `{ entries }` for `enum` (each entry
  `{ value, label, status, supersededBy }`), `{ minimum, maximum, step }` for
  `integer` and `number`, `{ maxLength, pattern, multiline }` for `text`, and
  `{}` for `boolean`. Deprecated fields and entries are kept, so stored values
  can still be shown.
- **Student outputs.** The optional `student_outputs` (epic #1124, #1131) are
  normalized to `studentOutputs`, next to `fields`: one
  `{ id, documentSchema, scopes, label, description }` per declared output,
  where `scopes` keeps `response` and `chat` only. An absent list declares no
  output. An entry without a kebab-case `id`, a `<name>/v<major>`
  `document_schema`, a student scope or both display texts, and a repeated
  `id`, are dropped with a warning, and the descriptor stays usable. See
  "Student result documents" for how they are used.
- **Cache.** In memory, per process, keyed by service and descriptor locale.
  A valid descriptor is kept for ten minutes. After a failure the result is
  kept for a minute before asking again; if an earlier fetch succeeded, its
  fields are served meanwhile with `stale: true`. Concurrent calls share one
  request. Nothing is stored in Redis. The student outputs of the last
  descriptor fetched successfully for each service, in any locale, are kept
  apart (`knownStudentOutputs(serviceId)`, no request): failed fetches and a
  changed or removed connection keep them, and only a newer successful fetch
  replaces them. `refreshStudentOutputs(serviceId)` fetches when the cache
  has nothing in date and returns them.

### Listing services

`GET /external-services` (role `P`) returns the services usable under the
current policy version (see "Usability"), without their adapter paths or
callback settings. Services that are not usable are never listed:

- Without `scope`, it returns every usable service.
- With `scope`, it returns only the usable services that declare at least one
  of the requested scopes. The parameter can be repeated
  (`?scope=response&scope=chat`). An unknown or empty scope answers `400`.

Each listed service carries `requires`, `development` and `usable` (always
`true`). `registry.listServices()` is the whole catalog, usable or not;
`registry.listUsableServices({ policyVersion })` keeps the usable ones. The
student activity descriptor includes only the services usable under the
session's pinned version.

A design keeps the ids it stores in `phases[].externalServices.enabledServiceIds`
when a service is not usable. The design editor neither shows nor drops them, so
the teacher's choice comes back when the service is usable again. Meanwhile
`dispatchHook` drops it, so nothing is dispatched to it and no job is created.

Each entry carries `ui: { component, translations }`, where `translations` is
the result of `getServiceUiTranslations()` or `null`. The design editor asks for
`?scope=response&scope=chat`, so services that only work on cases or designs
are not offered as phase options. `?scope=design` lists the services that
analyse designs.

Each entry also carries `descriptor`: `null` when the service declares no
capability descriptor, otherwise a summary in the teacher's locale (#728):

```json
"descriptor": { "serviceId": "polyadic-agent", "available": true, "name": "Polyadic Agents", "usesLlm": true }
```

When the descriptor cannot be fetched, `available` is `false`, `name` and
`usesLlm` are `null`, and the service is still listed, so stored selections
stay visible. The fields themselves come only from the next endpoint.

Descriptor text follows the language the teacher UI is showing (#745). The
design editor sends it as `locale` (`ExternalServicesCatalogService`, which
caches listings per UI language). Without `locale`, the teacher's
`preferred_locale` is used, or the first language of `Accept-Language` when it
is empty. All of them are normalized with the canonical rule (`es_*` →
`es_CL`, else `en_US`); both endpoints accept the parameter.

### Instance configuration

`GET /external-services/:id/instance-configuration` (role `P`) returns the
instance configuration the service's capability descriptor advertises, in the
teacher's locale, for the design editor (#728):

```json
{
  "status": "ok",
  "result": {
    "serviceId": "polyadic-devils-advocate",
    "available": true,
    "stale": false,
    "name": "Polyadic Agents",
    "usesLlm": true,
    "locale": "es_CL",
    "fields": [{ "key": "llm_tier", "type": "enum", "required": false, "default": "basic", "label": "Language Model Tier", "...": "..." }]
  }
}
```

- `serviceId` is the manifest id; `fields` follow the normalized shape
  described in "Capability descriptors". `stale: true` means the service is
  unavailable and these are the last fields fetched from it.
- When the descriptor cannot be fetched or is invalid, it answers `200` with
  `{ "serviceId": "...", "available": false, "reason": "unreachable" }`.
- It answers `404` for unknown or disabled services and for services without a
  descriptor.
- `runtime_configuration`, adapter and descriptor paths, callback settings and
  credentials are never returned.

### Configuration validation

`POST /designs` and `PATCH /designs/:id` validate each phase's
`externalServices.configurations` (#729) against the services' capability
descriptors before saving (#731, `services/service-configuration-validation.service.js`).
Only services listed in that phase's `enabledServiceIds` are checked;
configurations of other services are kept as they are.

Each value is checked for its field's `type`, enum membership, `minimum`,
`maximum` and `step`, `max_length` and `pattern`, and every `required` field
needs a value. Keys the descriptor does not define are errors. `null` means
"use the service default".

A save with errors answers `400`:

```json
{
  "status": "err",
  "code": "INVALID_SERVICE_CONFIGURATION",
  "message": "Some external service settings are not valid.",
  "errors": [
    { "phaseIndex": 0, "serviceId": "polyadic-devils-advocate", "field": "llm_tier", "code": "not_in_enum", "value": "premium" }
  ],
  "warnings": []
}
```

- `phaseIndex` is the 0-based index in `design.phases`; `serviceId` is the
  manifest id; `field` is the descriptor field key.
- Error `code`: `invalid_type`, `not_in_enum`, `below_minimum`,
  `above_maximum`, `step_mismatch`, `too_long`, `pattern_mismatch`,
  `required`, `unknown_field`.

A successful save answers `{ "status": "ok", ..., "warnings": [...] }`. Warnings
never block a save:

| `code` | Meaning | Extra keys |
| --- | --- | --- |
| `deprecated_field` | The field is deprecated. | `value`, `supersededBy` (field key) |
| `deprecated_value` | The enum value is deprecated. | `value`, `supersededBy` (value) |
| `no_longer_accepted` | The stored design already had this problem (same service, field, `reason` and value): the service retired the field or value, or tightened a limit. The teacher did not introduce it, so it does not block the save; the service warns or substitutes at instantiation. | `reason` (an error code), `value` |
| `not_validated` | The configuration was stored without validation (`field` is `null`). | `reason`: `unreachable`, `invalid_descriptor`, `unsupported_contract_version`, `service_id_mismatch`, or `no_descriptor` (unknown, disabled, or no descriptor) |

The descriptors are read in English through the descriptor cache, so a save
adds at most one request per service. The design editor's settings form (#732)
applies the same rules as the teacher types (they live in
`ethicapp/common/modules/service-configuration-rules.js`, shared by both) and
shows the `errors` of a `400` next to their fields.

### Handler signature

Every hook handler receives `(context, { callback, reportInstantiation })`,
except the collecting hooks `report-building` and `student-results-reading`,
which receive `(context, { results, signal })` (see "Report building" and
"Student results reading"):

- `context` is the object built by the dispatch site plus registry-injected
  fields. For hooks dispatched through `dispatchHook()` the registry adds
  `serviceId`, `jobId`, `correlationId` (equal to `jobId`),
  `enabledServiceIds` and `serviceConfiguration`. For `callback-received` it
  adds `serviceId`, `jobId` (the correlated job, if any), `resultId`,
  `isDuplicate` and `serviceConfiguration: {}`.
- `context.serviceConfiguration` (#734) is the settings object the design
  stores for this service in the hook's phase
  (`phases[n].externalServices.configurations[serviceId]`, validated against
  the service's capability descriptor on save, #731): descriptor field keys to
  scalars, holding only what the teacher set. It is `{}` when nothing is
  stored and for hooks without a phase (`case-created`, `activity-finished`,
  `callback-received`). It is read from the design when the hook fires and is
  a copy, so changing it has no effect. Adapters map it into the AI service's
  payload; unset keys mean "service default".
- `context.locale` (#1124) is the activity's locale, `es_CL` or `en_US`, from
  its design's `designs.language_code` by the rule in
  `helpers/activity-locale.js` (Spanish is `es_CL`, any other language
  `en_US`, none `es_CL`). Phase hooks carry it when the phase's services could
  be read (`dispatchPhaseHook()` takes it from the same query that reads them),
  and `student-results-reading` always carries it, `null` when it could not be
  read. Adapters write students' texts in that language or send it to their
  service; a hook without a phase has none.
- `callback(result)` records the adapter outcome against the job (see
  "Jobs and `callback(result)`" below).
- `reportInstantiation(report)` stores what an AI service reported when the
  adapter created a room or session for this job (see "Instantiation reports"
  below). It is only passed to handlers run by `dispatchHook()`.

Phase hooks are dispatched through `helpers/external-service-dispatch.js`
(`dispatchPhaseHook(hookName, context)`), which reads the phase's enabled
services and their settings with `getPhaseExternalServices(phaseId)`
(`helpers/designs-helper.js`, built on `helpers/phase-external-services.js`).

Handlers run concurrently with `Promise.allSettled`; a throwing handler marks
its job as `failed` and never affects other services or the originating HTTP
request. Dispatch sites additionally wrap dispatch in `try/catch`, so adapter
failures are isolated from teacher and student requests.

## Hook Catalog

| Hook | Fired from | Enablement scope | Context fields (before registry injection) |
| --- | --- | --- | --- |
| `activity-started` | `POST /activities/:id/phases/next` when the session enters `in_progress` (first phase only, see `helpers/activity-lifecycle-helper.js`) | Services enabled for the started phase | `sessionId`, `phaseId`, `startedPhaseId`, `endedPhaseId` |
| `phase-started` | Every phase transition | Services enabled for the started phase | `sessionId`, `phaseId` (= started), `startedPhaseId`, `endedPhaseId` |
| `phase-ended` | Phase transition, when a different phase was active before | Services enabled for the ended phase | `sessionId`, `phaseId` (= ended), `startedPhaseId`, `endedPhaseId` |
| `activity-finished` | `POST /activities/:id/finish` | Union of services enabled in any phase of the design | `sessionId`, `phaseId` (= last active), `startedPhaseId: null`, `endedPhaseId` |
| `student-response-submitted` | Student response endpoints in `controllers/activities/activities-student.js` | Services enabled for the phase | `sessionId`, `phaseId`, `userId`, `questionId`, `designType`, `requestPayload`, `responsePayload`, `source` (`{ kind: "response", id }`: the stored `differential_selection` row, or `actor_selection` for ranking) |
| `chat-message-received` | `controllers/group-messages.js` after a group chat message is saved | Services enabled for the phase | `sessionId`, `phaseId`, `questionId`, `groupId`, `userId`, `parentId`, `content`, `savedMessage`, `notificationPayload`, `designType`, `source` (`{ kind: "chat_message", id }`: the saved `differential_chat` row, or `chat` for ranking) |
| `case-created` | `POST /cases` after the case, authors, tags, analyses, and render job are persisted, `POST /cases/:id/analyses` after the added services are reserved, and `POST /cases/:id/analyses/:serviceId/generate` (`helpers/case-lifecycle-helper.js`) | The reserved services chosen for the case: at creation, the ones added later, or the one generate reaches | `caseId`, `caseUuid`, `userId` (creator), `title`, `pdfPath`, `languageCode`, `visibility`, `pdfRenderJobId` |
| `design-created` | After `POST /designs` answers, and after `POST /designs/:id/duplicate` (duplicate or import) commits the copy (`helpers/design-analyses-lifecycle-helper.js`) | Each design-scoped service whose generation was reserved, one dispatch per service (see "Design Analyses") | `trigger` (`"created"`), `designId`, `userId` (requester), `caseId`, `languageCode` (the case's), `design` (the design document), `analysisInput` and `inputHash` (from the service's `designAnalysisInput()`) |
| `design-updated` | After `PATCH /designs/:id` answers (`trigger: "updated"`), and from `POST /designs/:id/analyses/:serviceId/generate` with the current design (`trigger: "generate"`) (`helpers/design-analyses-lifecycle-helper.js`) | As for `design-created` | As for `design-created`, with `trigger` `"updated"` or `"generate"` |
| `callback-received` | `POST /external-services/callbacks` | Only the service named in the callback body | `serviceId`, `eventType`, `correlationId`, `eventId`, `requestPayload`, `rawBody`, `auth` |
| `report-building` | `registry.collectReportContributions(reportType, context)`, while an activity report is built (#944; the reports call it from #945) | The registered services subscribed to it with at least one job in the session, whatever the policy. Not dispatched through `dispatchHook()` (see "Report building") | `reportType`, `serviceId`, `sessionId`, `designType`, `rows` |
| `student-results-reading` | `registry.collectStudentResults({ sessionId, userId })`, when a student loads an activity (#1125; the student route calls it from #1127) | The registered services subscribed to it that the session's design enables in any phase and its pinned policy version allows; the AI Additions connection is not required. Not dispatched through `dispatchHook()` (see "Student results reading") | `serviceId`, `sessionId`, `userId` |
| `user-forgotten` | The user erasure processor (`services/user-erasure/`), for each pending request in `user_erasure_requests`, of a forgotten student (#876) or teacher (#877) | Global (`globalHooks`), one AI Additions service at a time: the adapters that declare it and require the request's service. An erasure hook: it skips the policy (see "Erasure hooks") | `userId` (the forgotten account), `erasureRequestId` |

### Hook enablement

Hooks are not broadcast to every registered adapter. `dispatchHook(hookName,
context, { enabledServiceIds })` only invokes subscribers whose `serviceId` is in
`enabledServiceIds`, and returns immediately when that list is empty. There are
three ways to resolve that audience:

**Phase-scoped hooks (activity design opt-in).** For activity hooks the
dispatch site resolves the audience from the activity design:
`design.phases[].externalServices.enabledServiceIds` (see
`canonical-schemas/ethicapp-v1.schema.json`, `helpers/designs-helper.js`, and
`helpers/activity-lifecycle-helper.js`). Teachers therefore opt a service into a
phase when authoring the design. The activity, phase, response, and chat hooks
in the catalog above are phase-scoped.

**Case hooks (case opt-in).** `case-created` reaches the services the teacher
chose for the case, when creating it (`analysisServiceIds`) or later (`POST
/cases/:id/analyses`, see "Case Analyses"): `dispatchCaseCreatedHook(context, {
reservations })` dispatches each reserved analysis to its service only
(`enabledServiceIds`), under the job id of its reservation (`jobIds`). A case
without a choice dispatches nothing, and editing the case never changes the
choice.

**Design hooks (reserved generations).** `design-created` and
`design-updated` reach only the design-scoped services whose generation was
reserved in `design_analyses` (`dispatchDesignHook(context, { reservations })`,
see "Design Analyses"), in the same way.

**Global hooks (manifest opt-in).** Hooks that fire outside an activity and
need no teacher choice are dispatched with
`registry.dispatchGlobalHook(hookName, context)`. Its audience is
every service whose catalog entry lists `hookName` in `globalHooks`, filtered
by the policy gate like any other dispatch. Opting in is decided in
the catalog; there is no teacher-facing UI for it. `dispatchGlobalHook` delegates to `dispatchHook`, so jobs,
`correlationId`, `callback(result)` handling, and error isolation are identical.

`user-forgotten` uses this path (#876). `case-created` did until the services
became a choice of each case (#649). `dispatchGlobalHook(hookName, context,
{ serviceIds })` narrows the audience to some of those services, so a caller
can dispatch to one service at a time and read its outcome from the returned
`Promise.allSettled` results.

**Erasure hooks.** `ERASURE_HOOKS` (`user-forgotten`) ask a service to erase
what it keeps about someone. They carry an id and no content, and a service
the current policy switched off may still hold data from when it was
allowed, so they skip the policy: every registered adapter among the
requested ones receives them, provided a usable AI Additions connection is
stored. Their handlers throw on failure instead of reporting a failed
`callback(result)`, so the caller records the failure and retries it.

The tutor and Polyadic adapters declare `user-forgotten`. The tutor's handler
calls `DELETE /argumentation-tutor/api/v2/users/{user_id}/data`, with the
`user_id` it sends with each argument; Polyadic's calls
`DELETE /polyadic-agent/api/participants/{participant_id}/data`. Both are
idempotent, and both answer counts, which the handler reports with
`callback(result)`. The erasure request processor in
`services/user-erasure/` dispatches it, records the outcome in
`user_erasure_requests` and retries failures with a backoff; see
`deploy/student-anonymization-overview.md`, "Erasure in AI Additions".

`globalHooks` is only consulted by `dispatchGlobalHook`. Listing a phase-scoped
hook such as `phase-started` there has no effect, because the activity dispatch
sites never read it.

Jobs created by case and global hooks have `session_id`, `phase_id`,
`question_id`, and `group_id` set to `NULL`; their `hook_name` tells them
apart.

### Report building

`report-building` (epic #620, #944) lets an adapter add what its service
produced during an activity to the activity's reports. The report generator
owns the report: its rows, its identity columns and the CSV; the adapter owns
the meaning of its stored results and decides how they cross with the report.

An adapter subscribes with the ordinary `subscribe("report-building",
handler)`. The registry accepts the handler only when the catalog entry lists
the hook in `hooks` and declares `report.columnPrefix`, and only one handler
per service.

**Collecting dispatch.** The hook is never dispatched through `dispatchHook()`,
which ignores it. The report generator calls
`registry.collectReportContributions(reportType, context, { reservedColumnIds })`
(`services/external-service-report-contributions.js`), which:

- asks the services that are registered, subscribed to `report-building` and
  have at least one `external_service_jobs` row (hook or room job) for
  `context.sessionId`. The AI service policy is not applied: the data was
  produced while the service was allowed;
- runs the handlers concurrently and awaits each one under its own timeout,
  `REPORT_CONTRIBUTION_TIMEOUT_MS` (5 s, no environment variable);
- creates no job or result row, passes no `callback` and calls no remote
  service; the adapter must not call its AI service either;
- resolves to one outcome per asked service, in subscription order. One
  service's outcome never affects another's:

| `status` | Meaning |
| --- | --- |
| `completed` | `contribution` holds the validated, normalized contribution. |
| `failed` | The handler threw or rejected. |
| `timed_out` | The handler did not settle within the timeout; what it returns later is ignored. |
| `invalid` | The contribution broke the contract; `problems` lists why. |

Every outcome but `completed` carries a short `reason` and is logged as one
`[external-services] Left out a report contribution.` line holding
`serviceId`, `reportType`, `sessionId` and `status`, plus `errorName` and
`errorCode` (when they look like identifiers, otherwise `null`) for `failed`,
`timeoutMs` for `timed_out` and `problems` for `invalid`. An adapter's error
message, its stack and its contributed values are never logged: they can quote
a student's text. Problems name paths and column ids only.
`collectReportContributions` rejects only for an unknown report type, a context
without a positive integer `sessionId` or without `rows`, or when the session's
services cannot be read.

**Context.** The handler's `context` is frozen:
`{ reportType, serviceId, sessionId, designType, rows }`, where `reportType` is
`responses` or `chat_transcript` and `rows` are the report's row keys:

- responses report: `{ responseId, phaseId, questionId, userId, groupId }`;
- chat transcript: `{ messageId, phaseId, questionId, groupId, userId,
  externalServiceId, externalServiceResultId, time }`. `externalServiceResultId`
  is the `external_service_results` row an agent message was published from
  (#947), or `null`; `time` is ISO 8601.

`phaseId` is the phase's `stages.id`, `questionId` the question's id
(`differential.id`) and `groupId` the row's team.

**Results reader.** The second argument is `{ results, signal }`. `signal` is an
`AbortSignal` aborted when the handler's timeout expires. `results` is the
only data access the handler gets
(`services/external-service-report-results.service.js`):

```js
const stored = await results.list({ hookName, phaseId, questionId, userId, groupId }); // all optional
// [{ id, jobId, hookName, status, phaseId, questionId, groupId, userId,
//    source, rawPayload, adapterResult, receivedAt }], oldest first
```

It returns this service's `external_service_results` for the report's session
only; filters cannot widen that scope, and unknown or malformed filters reject
with a `TypeError`. `hookName` is the hook of the job a result answers (for
example `student-response-submitted`), or `null` for a result without a job.
Unconsumed (`pending`) results are left out. `source` is the response or chat
message the result's job processed (#946), as `{ kind: "response" |
"chat_message", id }` with a numeric `id` (see "Jobs and `callback(result)`").
It is `null` for a result without a job and for a job that recorded none,
such as jobs of other hooks and jobs created before migration V38.

**Contribution contract.** The handler resolves to `undefined`/`null` (nothing
to add) or to:

```js
{
    columns: [{ id: "ats_title", label: "Title" }],         // label optional
    values:  [{ rowKey: 101, values: { ats_title: "..." } }],
    rows:    [{ phaseId, questionId, groupId, time, message, values }], // chat transcript only
}
```

- Each column `id` is snake_case, starts with the service's `columnPrefix`, is
  not repeated and is not one of the report's own columns (`reservedColumnIds`).
  A `label` is a string of at most 200 characters.
- `values` entries name a `rowKey` from `context.rows` (a `responseId` or a
  `messageId`) once at most, and map declared column ids to scalars: strings of
  at most 10,000 characters, finite numbers, booleans or `null`.
- `rows` are accepted by the chat transcript only. `phaseId` is a positive
  integer, `questionId` and `groupId` positive integers or `null`, `time` a
  date (normalized to ISO 8601), `message` a string or `null`, and `values` as
  above. The generator fills the identity columns itself and attributes the row
  to the service (`author_role = external_service`, #945).
- Unknown keys, unknown row keys, undeclared columns, non-scalar or over-long
  values, and rows for the responses report make the whole contribution
  `invalid`. Long strings are not truncated.

**Merging into the reports** (#945, `controllers/activities/report-contributions.js`).
Both semantic-differential reports (`GET /activity/:session_id/full_report`
and `GET /activity/:session_id/chat_transcript`) call the collector after
reading their rows, with their own columns as `reservedColumnIds`. Ranking
reports still answer 501.

- Each completed contribution's columns are appended after the report's
  columns, grouped by service in subscription order (the outcomes' order). The
  CSV header uses the column ids; labels are not exported. A row without a
  value for a column has an empty field. A service that adds no column, or
  whose contribution was left out, adds nothing to the header.
- Contributed chat rows are checked against the session: `phaseId` must be a
  phase of the session, `questionId` (when given) a question of that phase and
  `groupId` (when given) a group of that phase. A row that fails makes its
  whole contribution `invalid`, logged and audited like the collector's
  outcomes; if the session cannot be read, the contribution is `failed`.
- The generator fills a contributed row's transcript columns: `author_role` is
  `external_service`, `external_service_id` the service id, `name` and
  `external_agent_id` come from the service's `external_service_agents` row
  (the service id when it has none), the question columns from `questionId`,
  `team_id` from `groupId`, and `phase_number` from `phaseId`. `id`, `user_id`,
  `gender` and `reply_to` stay empty.
- Contributed rows are placed in the transcript's order (phase, question,
  group, time, NULLs last). The report's own rows keep their order; a
  contributed row that ties one of them goes after it, and ties between
  contributed rows keep the service order.
- Without any contributed column or row, the CSV is byte-identical to the
  report's own. The report is delivered whatever the outcomes, and its
  `row_count` counts contributed rows.
- The export's audit row (`activity_report_exports.metadata`) records
  `contributions`: one `{ serviceId, status, columns, values, rows }` per
  service asked, with counts only, plus `reason` for an outcome other than
  `completed` and `problems` for an `invalid` one. It holds no contributed
  value. When the collector itself rejects, the report is delivered without
  contributions and the metadata says `contributionsCollection: "failed"`.

**Development mocks.** With `EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true`, two
mock adapters contribute, so the merge can be checked on the local stack
without AI Additions. They read the report's row keys, since their hook
callbacks store no results:

- `mock-ai-response-review` (`mockreview_`) adds `mockreview_note` to every
  row of the responses report, with the number of stored results whose job
  processed that response (zero unless callbacks were posted to it). It adds
  nothing to the chat transcript.
- `mock-chat-agent` (`mockchat_`) adds `mockchat_shown_to_students` to the
  chat transcript: `true` on its own messages and `false` on one summary row
  per group it spoke in, placed a second after its last message there.

### Student results reading

`student-results-reading` (epic #1123, #1125) lets an adapter rebuild the
results it published to one student in one activity with
`publishStudentResult`, so the student app can show them again after a
reload, a new login or a socket that was down when they arrived. The
published results are not copied anywhere: the adapter rebuilds them from
its stored callbacks (`external_service_results.raw_payload`), as its report
contribution does. Erasure and redaction of those payloads (#580, #876)
therefore reach the rebuilt results too.

An adapter subscribes with `subscribe("student-results-reading", handler)`.
The registry accepts the handler only when the catalog entry lists the hook
in `hooks`, and only one handler per service. No other catalog declaration is
needed.

**Collecting dispatch.** The hook is never dispatched through `dispatchHook()`,
which ignores it. The caller (the student route below, #1127) calls
`registry.collectStudentResults({ sessionId, userId })`
(`services/external-service-student-results.js`), which:

- asks the services that are registered, subscribed to the hook and enabled
  for the session (`studentResultsServiceIds()`): the services the session's
  activity design enables in any phase
  (`getEnabledExternalServiceIdsBySessionId()`, none when the activity was
  launched with its AI services off, #970) that the session's pinned AI
  service policy version allows (`isAllowedByPolicy()`, #815). A session's
  pin never changes, so this is the policy its results were published under.
  The AI Additions connection is not required, since the handlers call no
  service. A pin that cannot be read allows no production adapter;
  development adapters need no pin;
- runs the handlers concurrently and awaits each one under its own timeout,
  `STUDENT_RESULTS_TIMEOUT_MS` (3 s, no environment variable; the student
  waits for it);
- creates no job or result row, passes no `callback` and calls no remote
  service; the adapter must not call its AI service either;
- resolves to one merged, frozen list (below). A handler that throws, rejects,
  times out or returns something other than a list contributes nothing; the
  others are unaffected.

It rejects only for a context without positive integer `sessionId` and
`userId`, or when the session's services cannot be read. The caller decides
which of the student's phases to show; the student route below keeps the
phases of the session.

**Context and reader.** The handler's `context` is frozen:
`{ serviceId, sessionId, userId, locale }`, where `locale` is the activity's
locale (`es_CL`, `en_US`), read once per call by the registry, or `null` when
it could not be read (logged with the session id only). The second argument is
`{ results, signal }`; `signal` is aborted when the timeout expires. `results`
is the only data access the handler gets
(`createStudentResultsReader()` in
`services/external-service-report-results.service.js`):

```js
const stored = await results.list({ hookName, phaseId, questionId }); // all optional
// [{ id, jobId, hookName, status, phaseId, questionId, groupId, userId,
//    source, rawPayload, adapterResult, receivedAt }], oldest first
```

It returns this service's `external_service_results` for the session whose
`user_id` is the student's, the user its job was dispatched for. Its rows
have the same shape as the report reader's, and `pending` results are left
out. `userId`, `groupId`, `serviceId` and `sessionId` are not filters, so the
scope cannot be widened; unknown or malformed filters reject with a
`TypeError`. Results of other statuses are returned with their `status`: the
adapter decides which ones it published (the tutor's report, for example,
ignores `failed` results).

**Return contract.** The handler resolves to `undefined`/`null` (nothing) or
to a list of the results it published, in the shape `publishStudentResult`
emits plus the id of the stored result each one was rebuilt from:

```js
[{
    resultId:    "<external_service_results.id>",
    phaseId:     20,
    questionId:  30,              // or null
    component:   { documentSchema: "student-result/v1" },
    payload:     { schemaVersion: "student-result/v1", locale: "en-US", /* ... */ },
    message:     "Feedback on your argument is now available.", // or null
    status:      "completed",
    publishedAt: "2026-11-05T10:00:00.000Z",
}]
```

Each entry is checked on its own; an entry that fails a check is dropped and
the others are kept:

- `resultId` is the id of a result this handler's own reader returned during
  this call, once at most. An entry that cites another service's result, or a
  result the reader never returned, is dropped.
- `phaseId` is a positive integer and `questionId` a positive integer or
  `null`; each must equal its result's `phaseId` or `questionId` when the
  result has one. The stored result keeps its callback's trusted destination,
  and an entry cannot move it to another phase or question.
- `component` is plain data and `payload` a plain data object. Both are
  copied and frozen, and are returned unchanged.
- A document (#1131) is `component: { documentSchema }`, with no other key in
  `component`, and the document as `payload`, as `publishStudentResult`
  emits it. It is kept only when it passes the checks of a published
  document, against the declaration this process already knows (see
  "Student result documents"). Any other `component` is a legacy result
  descriptor and needs a non-empty `componentId`.
- `message` is a string or `null`, `status` a non-empty string, and
  `publishedAt` a date, normalized to ISO 8601. The adapter usually takes it
  from the result's `receivedAt`.
- No other key is accepted.

The registry adds each entry's `serviceId` and orders the merged list by
`publishedAt`, oldest first; ties keep the subscription order and then each
handler's order. `resultId` lets the student app merge these entries with
the socket events (#1128).

**Logging.** A handler left out, and a handler some of whose entries were
dropped, is logged as one `[external-services] Left out student results.`
line holding `serviceId`, `sessionId` and `status` (`failed`, `timed_out`,
`invalid`, or `completed` with `kept` and `dropped` counts), plus `errorName`
and `errorCode` for `failed`, `timeoutMs` for `timed_out` and `problems` for
`invalid` and dropped entries. Problems name entry paths only; an adapter's
error message and its entries are never logged, since they can quote a
student's text. A refused document adds its schema, the problem codes and
the paths inside the document, as in
`entries[1].payload (student-result/v1) is refused: schema_violation (not_allowed) at claimTypeId`.

The tutor adapter subscribes (#1126, handler in
`adapters/ats-feedback.student-results.js`). It rebuilds the `completed`
results whose stored outcome, `adapterResult.payload.publishedToUserId`, names
the student, as the `student-result/v1` documents it publishes (#1133, see
"The tutor's student feedback"). The development mocks publish without
storing a result and stay live-only.

**Student route.** The student app reads the results with
`GET /activities/:id/users/:user_id/external_service_results`
(`controllers/activities/student-external-results.js`, #1127), where `:id` is
the session and `:user_id` the student.

- Guards. The route refuses what `full_state` refuses, with the same
  answers: 401 without a signed-in user, 403 for any role other
  than `A` before any lookup, 400 for ids that are not numbers, and the 404 of
  an unknown session (`{ "error": "Session not found." }`) for another
  student's id, a session the student is not enrolled in, an anonymized
  account and an unknown session (`requireSessionOwnerOrParticipant` with
  `subjectUserId`, #926).
- Phases. It answers the results of every phase of the session the student
  sees. The phase tabs of the student app show every phase `full_state`
  lists, which is every `stages` row of the session, and a row exists once its
  phase has started (#906). An entry whose `phaseId` is not one of those rows
  is left out: an adapter can name a phase for a stored result that has none,
  and a phase that a failed start replaced leaves its results behind. The
  hook already drops an entry without a positive integer `phaseId`, so a
  result whose phase is `null` reaches the route only when its adapter gives
  it a phase, and then follows the same rule. Each request that leaves
  entries out logs `[external-services] Left out student results of phases
  outside the session.` with `sessionId`, `userId` and the `dropped` count.
- Response. `200` with `{ "results": [...] }`, the entries of
  `collectStudentResults()` as they come (`serviceId`, `resultId`, `phaseId`,
  `questionId`, `component`, `payload`, `message`, `status`, `publishedAt`),
  oldest `publishedAt` first. An activity whose design enables no subscribed
  service, or whose services published nothing for the student, answers
  `{ "results": [] }`. When the session's services or phases cannot be read
  it answers `500` and logs `sessionId`, `userId`, `errorName` and
  `errorCode` only.
- Caching. None. Results arrive while the student works, so every request
  runs the hook (#1123 keeps them out of `full_state`, which is cached in
  Redis), and every answer carries `Cache-Control: no-store`.

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
as `jobId` and `correlationId` in the handler context. A caller that reserved
work under a job id beforehand passes `jobIds` (service id to job id) in the
dispatch options: the job is created under that id, and the handler receives
it even when the row cannot be created.

A job also records what its hook processed (#946), from the context's
`source: { kind, id }`, in `source_kind` and `source_id`:
`student-response-submitted` names the stored response (`response`), and
`chat-message-received` the saved message (`chat_message`). The activity's
design type says which table the id belongs to, so there is no foreign key.
Other hooks, room jobs and jobs created before migration V38 leave both
columns `NULL`, as does a `source` that is not a known kind with a positive
integer id. A callback correlated with the job gets it back as
`context.job.source` (`null` when there is none), so a result can be tied to
the exact response or message it came from, for example a reactive reply to
the student message it answered.

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
posts its result. No HTTP route lists jobs or results; a student reads the
results published to them through the route in "Student results reading".

### Instantiation reports

When an adapter creates a room or session, the AI service reports its
lifecycle verdicts on the settings it received (#133): deprecated values it
still accepts, retired values it substituted, unsupported fields that put it in
degraded mode. The adapter passes that report to `reportInstantiation(report)`,
and the registry stores it in `external_service_jobs.instantiation_report`
(jsonb, migration V17, #737) on the job that triggered the creation. It does not
change the job status, so asynchronous jobs can report before they complete.

```json
{
  "warnings": [
    { "field": "model", "verdict": "deprecated", "suggested_field": "llm_tier",
      "suggested_value": "basic", "message": "model is deprecated; use llm_tier instead",
      "room": "ethicapp-s12-p34-g5" }
  ],
  "degraded": false,
  "configurationRejected": false,
  "rooms": [{ "room": "ethicapp-s12-p34-g5", "degraded": false, "configurationRejected": false }]
}
```

- `warnings`, `degraded` and `configurationRejected` (the service refused the
  configured settings and the adapter fell back to defaults) are always
  present. Other keys are adapter-specific: Polyadic adds `rooms` (one entry per
  room; `rejection` holds the service's error when settings were refused) and
  tags each warning with its `room`. The Argumentation Tutor adds `llmTier`,
  the resolved `model`, the `questionKey` of the session and its mode (see
  "The tutor's modes").
- A report with warnings, degraded mode or rejected settings is also logged as
  one `[external-services] Instantiation report.` line with its job id.
- Once a report is stored, the registry emits `onExternalServiceInstantiated`
  (`{ serviceId, sessionId, phaseId, questionId }`, the ids only) to the
  session's room on the `/teacher` socket namespace (#865), so a teacher view
  can read what it needs again.
- `NULL` means the job instantiated nothing. Teachers see the tutor's modes
  (`GET /activities/:session_id/tutor-modes`); the other reports have no
  screen yet.

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

- `serviceId` is required and must match a registered catalog entry. A
  callback that matches one of that service's jobs goes to the job's
  destination; one that matches no job is accepted only for a verified
  destination (see "Usability", #815).
- `eventType` defaults to `"result"`.
- `correlationId` is matched against `external_service_jobs.id`; the response
  reports `correlationStatus: "matched"` or `"unknown"`.
- `eventId`, when provided, must be a UUID. A repeated `eventId` for the same
  service is recorded as a duplicate and is **not** dispatched to the adapter
  (`202`, `isDuplicate: true`) once it is consumed. While it is still
  `pending` (#815: the earlier attempt was refused with `503`, or failed before
  it could claim it), the retry is authorized and, if it claims the result,
  delivered. Attempts that lose the claim get the usual duplicate answer
  (`202`, nothing delivered), so the sender stops retrying while the claimer
  carries the event. Events delivered or refused with `409` stay duplicates.

The registry creates an `external_service_results` row, then dispatches
`callback-received` only to the subscribers of the named service with the
context listed in the Hook Catalog. The endpoint answers `202` with
`{ status: "accepted", result: { ..., correlationStatus, resultId, isDuplicate, dispatched } }`.

## Available Hook Publishers

The registry provides two helper publishers to adapters:

- `publishStudentResult(payload)`: sends a socket notification to a student.
  The payload must include a valid positive integer `userId`; the registry adds
  `serviceId` and `receivedAt`. Returns `true` when the notification was sent,
  `false` otherwise. A result for students is a document,
  `{ userId, documentSchema, document }`, checked as described in "Student
  result documents" below; the legacy `{ component, payload }` form is kept
  for the adapters that have not moved yet. Nothing is stored and a socket that is down misses it, so
  an adapter that publishes from a callback also subscribes to
  `student-results-reading` (see "Student results reading") to rebuild what it
  published from the stored callback when the student loads the activity.
- `publishGroupChatMessage(payload)`: saves a message authored by the external
  service and publishes chat notifications to the group and the teacher. The
  payload must include `content`, `phaseId`, `questionId`, and `groupId`;
  `sessionId`, `parentId`, and `agentDisplayName` are optional but should be
  provided when available. The agent identity is upserted in
  `external_service_agents` by `serviceId`. Returns
  `{ savedMessage, notificationPayload }` or `null` when the payload is
  incomplete or the message could not be saved.

  A handler of `callback-received` that publishes a message passes
  `resultId: context.resultId` (#947). The message row (`chat` or
  `differential_chat`) then stores it in `external_service_result_id`
  (`database/migrations/V39__chat_external_service_result_link.sql`), so the
  activity reports can read from that callback's result what the message row
  does not keep: which agent wrote it and which job the callback answered.
  `external_service_agents` holds one row per service, and its
  `display_name` is overwritten with the latest agent name, so the result is
  where the name of each message's agent survives. The Polyadic bridge also
  lists the messages it published, `publishedMessages: [{ messageId,
  agentName }]`, in its callback payload, which is stored in the result's
  `adapter_result`. A message published outside a callback, or with a
  `resultId` that is not a uuid, is saved with no link (the invalid id is
  logged). Students' and teachers' messages never carry one. Deleting a
  result sets the link to `NULL` and keeps the message.

### Student result documents

A result shown to a student is a document of a schema that ethicapp-ai-additions
defines, today `student-result/v1` (epic #1124; contract in `EXTERNAL.md`,
"Student result documents"). The adapter publishes it with:

```js
await publishStudentResult({
    userId,
    sessionId,                          // optional, like every key below
    phaseId,
    questionId,
    resultId:       context.resultId,   // the stored callback it came from
    message:        "Your feedback is ready.",
    status:         "completed",
    documentSchema: "student-result/v1",
    document,                           // the document, as the service wrote it
});
```

The student receives `component: { documentSchema }` with the document as
`payload`, the keys above, `serviceId` and `receivedAt`. Any other key the
adapter passes is left out of the event, so a teacher-only value cannot
travel next to the document.

**Checks.** `services/student-result-documents.js` checks every document,
published or rebuilt, in two ways:

- Schema. The document must validate against EthicApp's verbatim copy of its
  schema in `canonical-schemas/ai-additions/`, compiled with
  `@cfworker/json-schema` (draft 2020-12, the validator of
  `npm run test:schemas`), and pass the two integrity rules JSON Schema cannot
  express: criterion keys unique within a section
  (`duplicate_criterion_key`) and scores within their bounds
  (`score_out_of_range`), as ethicapp-ai-additions'
  `validate_student_result()` checks them. The JSON form of the document is
  checked, since that is what the student receives: a key set to
  `undefined` is left out. A schema EthicApp has no copy of is
  `unknown_document_schema`; a copy that cannot be read refuses all its
  documents (`schema_unavailable`) and is logged once.
- Declaration. The service must declare the schema, in its capability
  descriptor's `student_outputs`, for the scope the document reaches the
  student in (`undeclared_document_schema`). A development adapter, which
  links no descriptor, declares in its catalog entry instead (see "Catalog
  declarations of development adapters" below). Any other service whose
  catalog entry links no descriptor declares nothing (`no_descriptor`).

A document that fails a check is not sent. `publishStudentResult` returns
`false` and logs `[external-services] Refused a student result document.`
with `serviceId`, `userId`, `resultId` (when it is a uuid), `documentSchema`
(when it is a schema name), `scope`, the declaration status and the problems
(`code`, `path` and, for a schema violation, the JSON Schema `keyword`).
Neither the document nor the validator's messages are logged, since they
quote the student. A publication that mixes the two forms (`documentSchema`
or `document` together with `component` or `payload`) is refused as
`ambiguous_result`, and a legacy `component` that names a `documentSchema` as
`document_in_component`: a document always takes the document form.

**Scope.** `publishStudentResult` and the `student-results-reading` hook
carry a result for one student about the response they submitted, so their
documents are checked against the `response` scope (`STUDENT_RESULT_SCOPE`).
The descriptor's other student scope, `chat`, is for documents shown to
students in a group chat. No publisher emits them yet; the chat publisher
that does will check its documents against `chat`. A service that declares an
output for `chat` only cannot publish it through `publishStudentResult`.

**Where the declaration comes from.** Both paths read the declaration from
the descriptor service (see "Capability descriptors"), and neither waits for
a service that is down:

- Live publication. When the declaration this process knows is missing or
  older than the descriptor TTL (ten minutes), the registry refreshes it
  first, through the cached descriptor request with its 5 s timeout. The
  service has just called back, so it is normally reachable. When the request
  fails, the last declaration fetched since the process started is used.
  With none, the document is refused as `declaration_unavailable`.
- Rebuilt results. A student waits for the rebuild (3 s) and the service may
  be down, so the check makes no request and reads no connection: it uses the
  last declaration fetched since the process started, kept while the service
  is down and when the AI Additions connection changes or is removed. When
  there is none, or it is older than the TTL, a refresh starts in the
  background and serves later reads; the current read does not wait for it.
  With no declaration at all, the rebuilt documents are dropped as
  `declaration_unavailable` (legacy entries are unaffected).

The last case is a process that has not fetched the service's descriptor once
since it started, while the service is unreachable: rebuilt documents stay
hidden until a fetch succeeds. A fetch starts on the first read that
rebuilds a document, on a live publication and when teachers list services
or open the design editor, so the window closes once the service answers.

**Catalog declarations of development adapters.** A development adapter
requires no AI Additions service, so it cannot link a capability descriptor,
and nothing would declare its documents. It declares them in its
`manifest.json` entry instead (#1134), in the shape of a normalized
`student_outputs` entry:

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

`catalog.js` (`manifestStudentOutputs()`) normalizes each entry with the
descriptor's `normalizeStudentOutput()`, so both declarations follow the same
rules. What the descriptor path drops with a warning rejects the catalog
here, since the catalog is shipped code: an unknown key or scope, a repeated
id, or a scope the entry does not list in `scopes`. When the service links no
descriptor, both the live and the rebuild checks read this declaration, with
no request; it ships with the catalog, so it is always known. A service with
a descriptor link is judged by its descriptor alone.

A production adapter that declares `studentOutputs` rejects the catalog,
which stops startup and the image build. Its declaration belongs to the
service, in the descriptor the service publishes: a catalog entry that
declared for it would let EthicApp accept documents the service never
announced. Ignoring the key with a warning would leave an entry that reads as
a declaration and has no effect, which a startup log line easily hides.

**Legacy form.** `{ userId, component: { componentId, ... }, payload, ... }` is
emitted as passed, with no descriptor request. No adapter in this repository
uses it any longer: the tutor (#1133) and the development mock (#1134)
publish documents. It stays for adapters outside the repository and is
removed together with the student app's legacy component registry. Rebuilt
legacy entries keep the checks listed in "Student results reading".

**Adding a schema.** A new document schema is copied into
`canonical-schemas/ai-additions/` (see its README) and added to
`DOCUMENT_SCHEMAS` in `services/student-result-documents.js`, with its
integrity rules, before any service declares it.

## Case Analyses

Case-scoped services analyse case documents. Their results live in
`case_analyses` (`database/migrations/V21__case_analyses.sql`): one row per case
and chosen service, holding the current result. Raw callbacks still go to
`external_service_results`.

### Choosing services

Teachers choose the services when they create a case: `POST /cases` accepts
`analysisServiceIds`, a JSON array of service ids, like `tag_ids`. Each id must
name a service with the `case` scope that is usable under the current policy
version (the form lists `GET /external-services?scope=case`); otherwise, or when the value is
not such a list, the request answers `400 CASE_ANALYSIS_SERVICE_INVALID` before
the PDF is stored. Each chosen service gets a `requested` row, already reserved
for its first generation, and `case-created` is dispatched to those services
only, under the reserved job ids. Editing a case never changes its choice; a
copy of a case inherits the source's ready analyses and requests the others
(#1038).

The case's creator can add services later from the case view (#1039): `POST
/cases/:id/analyses` takes `{ serviceIds }`, validated as at creation (an empty
list answers `400 CASE_ANALYSIS_SERVICE_INVALID` too). Each service the case
has not chosen yet gets a reserved row and its `case-created` dispatch, with the
case's render job; a service already chosen is left as it is. The insert skips
existing rows (`ON CONFLICT DO NOTHING`) and only the rows it returns are
dispatched, so two concurrent requests for a service create one analysis and
one generation. It is accepted for a case in use or archived, like the other
analysis endpoints: an analysis changes neither the case nor what activities
showed (epic #1008, decision of 2026-11-02).

For the same reason the creator can remove a service from the choice (#1040):
`DELETE /cases/:id/analyses/:serviceId` deletes its row, with the document and
the teacher's edits. Nothing else reads `case_analyses` (students, designs and
activities do not), and copies of the case have their own rows (#1038), so
neither is affected. Adding the service again creates a new choice and a new
generation. A removal does not wait for a generation in flight and does not
cancel the external request: the adapter may still finish its work, but its
`markProcessing`, `complete` or `fail` finds no row for its job, stores
nothing and returns `null` (see "Recording results from an adapter").

Two decisions bound each analysis. The installation decides which services may
be offered at all: only services its manifest enables are valid, and the
default manifest enables none (#811). Within that, the case author decides, per
case, whether the case is analysed and by which services; nothing is analysed
without that choice. Epic #810 moves the installation's decision to a policy
managed in the management console, and keeps the author's choice.

### Statuses

| Status | Meaning |
| --- | --- |
| `requested` | A generation is reserved under `job_id` and its adapter has not started it. |
| `processing` | The adapter started the reserved generation. |
| `ready` | `document` holds the latest result. |
| `failed` | The latest generation failed and there is no document. |

A new generation keeps the previous document until its result arrives. A failed
generation keeps an existing document (the status stays `ready`) and records
`error_code` and `error_message`.

### Reserving generations

A generation is reserved before it is dispatched: one conditional `UPDATE`
(`reserveCaseAnalysisGeneration()` in `helpers/case-analyses-helper.js`) marks
the row `requested` under a new `job_id`, unless a generation is already in
flight. `POST /cases` inserts the rows already reserved. Because the check and
the reservation are one statement, of two concurrent requests only one is
accepted, and no edit is accepted between the response and the adapter start.

A generation is in flight while it is `requested` or `processing`: new
generations and teacher edits answer `409` until its result arrives. One with
no update for 15 minutes is stale: the teacher can save edits or generate
again, and the stale job can no longer start or store its result.

The adapter starts its reservation before its `case-created` handler settles.
Once a service's dispatch settles, a reservation still `requested` under its
job is released (`releaseUnstartedCaseAnalysis()`): the service has no
handler, the dispatch failed, or the handler failed or returned before starting
it. The release ends the generation like a failed one, with `error_code`
`generation-not-started`, so new generations and edits are accepted again
right away instead of after 15 minutes.

### Recording results from an adapter

`register()` receives `caseAnalyses`, bound to the adapter's own service:

- `markProcessing({ caseId, jobId })` starts the generation reserved under
  `jobId`, the `jobId` of the hook context, and returns the analysis. Await it
  before the `case-created` handler settles; a reservation not started by then
  is released. It returns `null` when that generation is no longer the reserved
  one (a newer generation or a teacher edit replaced it, or it already started)
  or the context has no `jobId`; the adapter must then skip the work.
- `complete({ jobId, documentSchema, document })` stores the document, which
  replaces the previous one and its review.
- `fail({ jobId, errorCode, errorMessage })` records a failed generation.

`complete` and `fail` only apply to a generation started with `markProcessing`;
results of superseded jobs, and of analyses the teacher removed meanwhile, are
ignored and return `null`. The adapter then reports its callback as skipped. An adapter that hits
an unexpected error after starting a generation calls `fail`, as the mock does,
so the analysis does not stay `processing` until it is stale.

`case-created` fires before the PDF worker extracts the case text. Adapters that
need it wait with `waitForCaseDocumentText(caseId)` from
`helpers/case-document-render-helper.js`, which returns `ready` with the text,
or `no-document`, `render-failed`, `superseded`, or `timeout`. The wait runs in
the web process: a restart drops it and leaves the analysis `processing` until
it is stale, and generating again recovers it.

### Error codes

Adapters record failures with the codes below, so the case view can explain
each one in the teacher's language: `ERROR_KEYS` in
`ethicapp/frontend/assets/js/helpers/case-analyses.js` maps every code to a
`case_analysis_error_*` key defined in both locales. Other codes show a generic
explanation. `error_message` holds an English detail, shown under it.

| `error_code` | Meaning |
| --- | --- |
| `no-document` | The case has no document. |
| `render-failed` | The PDF worker could not extract the case text. |
| `superseded` | A newer document replaced the case document during the wait. |
| `timeout` | The case text was not extracted in time (the render wait, not the AI service). |
| `empty-case-text` | The extracted text is blank. |
| `case-text-too-long` | The text is longer than the AI service accepts. |
| `request-rejected` | The AI service answered the request with a 4xx, for example a 422 validation error. |
| `request-failed` | No AI Additions connection, a network error, a request timeout or a 5xx. |
| `service-<code>` | The AI service's failed result, with its sanitized public code: `service-llm-error`, `service-llm-refusal`, `service-invalid-output`, `service-timeout`, `service-worker-lost`, `service-internal-error`. |
| `invalid-result` | The callback payload or its document cannot be read. |
| `adapter-error` | The adapter failed unexpectedly after starting the generation. |
| `generation-not-started` | Set by the registry: the adapter did not start the reserved generation. |

The `service-` prefix keeps the AI service's codes apart from EthicApp's own,
for example its `timeout` from the render `timeout`. A new code needs an
`ERROR_KEYS` entry and keys in `es_CL` and `en_US`.

Case Analyst modules do not all publish the same codes. The evidence inventory
adapter maps its module's codes (`SERVICE_ERROR_CODES` in
`adapters/case-analyst-evidence-inventory.adapter.js`):

| Case Analyst `error.code` | `error_code` |
| --- | --- |
| `llm_error`, `llm_request_failed`, `llm_not_configured`, `llm_tier_unsupported` | `service-llm-error` |
| `llm_refused` | `service-llm-refusal` |
| `llm_output_invalid`, `llm_output_truncated`, `inventory_invalid`, `inventory_too_large` | `service-invalid-output` |
| `timeout` | `service-timeout` |
| `worker_lost` | `service-worker-lost` |
| `internal_error` and any other code | `service-internal-error` |

### Teacher edits

An adapter may export
`validateCaseAnalysisDocument(document, { caseId, languageCode, getCaseText, currentDocument })`.
`currentDocument` is the stored document the edit replaces, or `null`, so an
adapter can keep what the teacher does not edit (for example how the draft was
generated). It returns `{ document, documentSchema }` with the document to
store, or `{ errors }`. Services without it accept no edits.

### API

Only the case creator can use these endpoints: students get `403` and other
teachers `404 CASE_NOT_FOUND`. Services not chosen for the case answer
`404 CASE_ANALYSIS_NOT_FOUND`.

| Endpoint | Description |
| --- | --- |
| `GET /cases/:id/analyses` | The chosen services with status and timestamps, without documents. Each entry also carries `ui: { component, translations }`, as in `GET /external-services`, and `usable`, whether the service is usable now (see "Case view tabs"). |
| `POST /cases/:id/analyses` | Body `{ serviceIds }`. Reserves and dispatches the services the case has not chosen yet (see "Choosing services") and answers `202` with the case's analyses, as `GET /cases/:id/analyses` lists them. Answers `400 CASE_ANALYSIS_SERVICE_INVALID` for an empty list, a value that is not a list, or an id that is not a usable case-scoped service. |
| `GET /cases/:id/analyses/:serviceId` | One analysis with its document. |
| `PUT /cases/:id/analyses/:serviceId` | Body `{ document }`, validated by the adapter. Answers `405 CASE_ANALYSIS_NOT_EDITABLE` without a validator, `400 CASE_ANALYSIS_DOCUMENT_INVALID` with `details`, and `409 CASE_ANALYSIS_PROCESSING` while a generation is in flight. Records `reviewed_at` and `reviewed_by`. |
| `DELETE /cases/:id/analyses/:serviceId` | Removes the service from the case's choice (#1040): deletes its analysis, with the document and the teacher's edits, and answers `204` without a body. Accepted for a case in use or archived and while a generation is in flight, whose late result is then dropped. |
| `POST /cases/:id/analyses/:serviceId/generate` | Reserves a new generation, replays `case-created` for that service only, and answers `202` with the reserved analysis. Answers `409 CASE_ANALYSIS_PROCESSING` while a generation is in flight and `503 CASE_ANALYSIS_SERVICE_DISABLED` when the service is disabled. It also recovers stale generations. |

`mock-case-analysis` (`adapters/mock-case-analysis.adapter.js`) is the reference
implementation: it runs in the web process, counts the words of the case, and
stores an excerpt.

### Case view tabs

The teacher case view (#651) shows the case text as its first and default tab,
then one tab per chosen service, in the order of `GET /cases/:id/analyses`.
Cases without analyses show no tab bar. The tab title is the adapter's
`tabTitle` in the UI language, or its `label`, or the service id. An analysis
tab loads its document (`GET /cases/:id/analyses/:serviceId`) only when it is
opened, and the list is polled while a generation is in flight.

For the case's creator, "Add analysis", at the end of the tab bar, offers the
usable case-scoped services (`GET /external-services?scope=case`) the case has
not chosen. It shows only when there is one, opens a dialog with the creation
form's options (`case-analysis-options` in `add` mode) and calls `POST
/cases/:id/analyses`; the new tabs appear in their processing state and the
list is polled as after creation.

AngularJS cannot load a component named by the manifest, so the frontend keeps
an allowlist from `ui.component` to registered components
(`CASE_ANALYSIS_COMPONENTS` in `ethicapp/frontend/assets/js/helpers/case-analyses.js`).
A service whose component is missing or not in the allowlist gets the generic
panel, which shows the document's fields read-only. Either way the tab shows
the status, the latest error and "Generate again" (with a confirmation), which
is offered only when the service is `usable`. While a generation is in flight,
the tab says that a previous result is shown below only when there is one: the
document the tab shows predates the generation, by its `generatedAt` (or
`reviewedAt`) against the listing's.

For the case's creator, each analysis tab also offers "Remove analysis"
(#1040). Its dialog says that the result and the teacher's changes are deleted
and that the analysis can be added again; while a generation is in flight it
adds that the service may finish its work but its result is discarded. Once
`DELETE /cases/:id/analyses/:serviceId` answers, the tab goes away, the view
opens the case text, a toast confirms, and "Add analysis" offers the service
again.

To add a view for a new service:

1. Declare `ui: { component: "<name>" }` in its manifest entry.
2. Register an AngularJS component in `ethicapp/frontend/assets/js/modules/teacher/teacher-admin.mjs` with
   the bindings `analysis` (the analysis with its `document`), `caseItem` and
   `onAnalysisUpdated` (call it with the analysis a `PUT` returns).
3. Map `<name>` to the component's element name in `CASE_ANALYSIS_COMPONENTS`.

`mock-case-analysis` has one (`mock-case-analysis-view`).

### Case evaluation (Case Analyst)

`case-analyst-evaluation` (`adapters/case-analyst-evaluation.adapter.js`, #844)
stores Case Analyst's case evaluation: feedback for the case author on the case
as discussion material. It requires the AI Additions service `case-analyst` and
its callbacks come from the Keycloak client `case-analyst-api`. The contract is
defined in ethicapp-ai-additions, `case-analyst/app/modules/case_evaluation/`
(`schemas/`, `examples/`) and `case-analyst/README.md` ("Case evaluation").

On `case-created` the adapter:

1. starts the reserved generation (`markProcessing`) and waits for the case
   text (`waitForCaseDocumentText`);
2. posts a `case-evaluation-request/v1` to
   `/case-analyst/api/v1/evaluations`:
   `case: { id, title, text, language }` and
   `clientContext: { service: "case-analyst-evaluation", correlationId: <jobId>, caseId }`
   (`service` is the adapter id, as Case Analyst's envelope documents).
   Ids are strings, the title is cut to 500 characters, and `language` is the
   case's `language_code` normalized by the canonical rule (`es_*` is `es_CL`,
   anything else `en_US`; a case without one is `es_CL`). EthicApp sends no
   optional `context`;
3. leaves the job `dispatched`. Case Analyst answers `202 { taskId }` and
   takes about two and a half minutes.

Failures before the result arrives fail the generation with the codes of
"Error codes": the render outcomes, `empty-case-text`, `case-text-too-long`
(over the 200,000 characters Case Analyst accepts), `request-rejected` and
`request-failed`.

The result is a `callback-received` with serviceId `case-analyst-evaluation`,
`correlationId` = the job id, and a `case-evaluation-result/v1` payload:

- `completed`: the `evaluation` is stored as a `case-evaluation/v1` document
  (`complete`). The adapter checks the parts the tab reads (language,
  evaluations with their criteria, synthesis); a payload or evaluation that
  fails the check fails the generation with `invalid-result`.
- `failed`: the generation fails with the service's message and its public
  code prefixed with `service-`; an unknown code is `service-internal-error`.
- A result whose `clientContext.correlationId` differs from its job is refused
  and leaves the analysis as it is. A result of a superseded generation is
  only kept in `external_service_results` (the callback reports `skipped`).

The evaluation is feedback for the author, so the adapter exports no
validator and `PUT` answers `405`. The tab component `case-evaluation`
(`case-evaluation-view`, helpers in
`ethicapp/frontend/assets/js/helpers/case-evaluation.js`) shows the final
feedback and the issues worth revising first, then the feedback of each
evaluator by criterion. Criterion and evaluator names are translated with
`case_evaluation_criterion_*` and `case_evaluation_evaluator_*`; a criterion
added by a new prompt version is shown by its name.

### Evidence inventory (Case Analyst)

`case-analyst-evidence-inventory`
(`adapters/case-analyst-evidence-inventory.adapter.js`, #652, a rework of
Daniel Ávila's PR #643) stores Case Analyst's evidence inventory of a case: the
facts a student may invoke as evidence (`EV#`, each with a literal
`sourceQuote` and a `sourceQuoteFound` flag) and the plausible statements the
case does not make (`EX#`). The teacher reviews and edits it. It requires the
AI Additions service `case-analyst` and its callbacks come from the Keycloak
client `case-analyst-api`. The contract is defined in ethicapp-ai-additions,
`case-analyst/app/modules/evidence_inventory/` and `case-analyst/README.md`
("Evidence inventory").

On `case-created` the adapter:

1. starts the reserved generation (`markProcessing`) and waits for the case
   text (`waitForCaseDocumentText`);
2. posts an `evidence-inventory-request/v1` to
   `/case-analyst/api/v1/evidence-inventories`:
   `case: { id, title, text, language }` and
   `clientContext: { service: "case-analyst-evidence-inventory", correlationId: <jobId>, caseId }`.
   Ids are strings, the title is cut to 500 characters, and `language` follows
   the same rule as the case evaluation;
3. leaves the job `dispatched`. Case Analyst answers `202 { taskId }` and
   takes about one minute.

Failures before the result arrives use the codes of "Error codes": the render
outcomes, `empty-case-text`, `case-text-too-long`, `request-rejected` and
`request-failed`.

The result is a `callback-received` with serviceId
`case-analyst-evidence-inventory`, `correlationId` = the job id, and an
`evidence-inventory-result/v1` payload:

- `completed`: the inventory is checked with `normalizeEvidenceInventory()`
  (`helpers/evidence-inventory-document.js`) and stored as an
  `evidence-inventory/v1` document, keeping the service's quote flags. A
  payload or inventory that fails the check fails the generation with
  `invalid-result`.
- `failed`: the generation fails with the service's message and its code
  mapped as in "Error codes".
- A result whose `clientContext.correlationId` differs from its job is refused
  and leaves the analysis as it is. A result of a superseded generation is
  only kept in `external_service_results` (the callback reports `skipped`).

Teachers edit the inventory. `validateCaseAnalysisDocument()` normalizes the
edit, keeps the existing ids, numbers new items after the highest one and
checks every quote again against the case text; when the text cannot be read,
no quote counts as found. The quote normalization mirrors
`case-analyst/app/modules/evidence_inventory/postprocess.py`, and both share
the same test cases, so keep them in sync. Case Analyst's Sebastián example
(request text and completed result) is kept in
`helpers/__tests__/fixtures/evidence-inventory/` for the tests.

The tab component `case-evidence-inventory` (`case-evidence-inventory-view`,
helpers in `ethicapp/frontend/assets/js/helpers/evidence-inventory.js`) shows
the facts by theme with their quotes, marks the quotes the server did not
find, and lets the teacher edit, add and remove facts and exclusions and save
them as reviewed (`reviewedAt`). Edits are offered only while no fresh
generation is in flight; "Generate again" comes from the surrounding panel.

### Topic listing (Case Analyst)

`case-analyst-topic-listing` (`adapters/case-analyst-topic-listing.adapter.js`,
#845) stores the topics participants must address when they discuss the case,
for the teacher to review and edit. It ports the "pedagogical minute" of Justin
Pinto's Case Analyst prototype, which kept the list in the browser only. It
requires the AI Additions service `case-analyst` and its callbacks come from
the Keycloak client `case-analyst-api`. The contract is defined in
ethicapp-ai-additions, `case-analyst/app/modules/topic_listing/` (`schemas/`,
`examples/`) and `case-analyst/README.md` ("Topic listing").

The request follows the case evaluation's steps above, with
`schemaVersion: "topic-listing-request/v1"`, the path
`/case-analyst/api/v1/topic-listings` and
`clientContext.service: "case-analyst-topic-listing"`. Case Analyst answers
`202 { taskId, status: "queued" }` and takes about twenty seconds. The same
failures before the result fail the generation with the same codes.

The result is a `callback-received` with serviceId
`case-analyst-topic-listing`, `correlationId` = the job id, and a
`topic-listing-result/v1` payload:

- `completed`: `topicListing` is stored as a `topic-listing/v1` document:
  `{ schemaVersion, language, topics: [{ id, topic, description }], generation? }`,
  1 to 20 topics, ids `T1`, `T2`... (at most 6 characters), non-blank
  `topic` (at most 160 characters) and `description` (at most 600), no other
  keys. The adapter checks the whole document, including that ids are unique,
  which JSON Schema cannot express (`helpers/topic-listing-document.js`); a
  document that fails the check fails the generation with `invalid-result`.
- `failed`: the error carries Case Analyst's core codes ("Bounded jobs" in its
  README), recorded as the shared `service-<code>`: `llm_request_failed` and
  `llm_not_configured` are `service-llm-error`, `llm_refused` is
  `service-llm-refusal`, `llm_output_invalid` and `llm_output_truncated` are
  `service-invalid-output`, and `timeout`, `worker_lost` and `internal_error`
  keep their names. An unknown code is `service-internal-error`.
- Uncorrelated and late results are handled as for the case evaluation.

Teacher edits (`PUT`, `validateCaseAnalysisDocument`) are checked against the
same constraints. The validator trims the texts and drops keys a topic does
not define. It keeps every id the edit sends, in the order sent, and never
renumbers the listing. A topic without an id is new and gets the number after
the highest id of the edit and of the stored listing, so a topic removed in the
same edit does not lend its id to a new one. `generation` describes the
generated draft, so it is copied from the stored listing (`currentDocument`)
and never taken from the edit. Invalid edits answer `400` with the problems as
`details`, for example a duplicate id, a blank text or more than 20 topics.

The tab component `case-topic-listing` (`case-topic-listing-view`, helpers in
`ethicapp/frontend/assets/js/helpers/topic-listing.js`) lists the topics with
their ids, shows whether the listing is a draft or reviewed, and edits it:
change, add, remove and reorder topics with up and down buttons that keep the
keyboard focus and announce each move. Saving stores the listing as reviewed
through `PUT`. Edit is not offered while a fresh generation is in flight.

## Design Analyses

Design-scoped services (scope `design`) analyse activity designs (epic #846).
Their results live in `design_analyses`
(`database/migrations/V25__design_analyses.sql`): one row per design and
service, holding the current result, outside the design document, whose schema
does not change. Deleting a design deletes its analyses (`ON DELETE CASCADE`).
Raw callbacks still go to `external_service_results`.

Design analyses follow the case analyses lifecycle: the same statuses, the same
15-minute stale window, and completion and failure conditional on the job id of
the current generation (see "Statuses" and "Reserving generations" above). The
statements both tables share live in `helpers/analyses-store-helper.js`; the
design ones are wrapped in `helpers/design-analyses-helper.js`. What differs:

- **No choice in advance.** Teachers choose nothing: creating or saving a
  design requests the analyses of every design-scoped service that applies
  (see "Analyses on creation and save"). The first reservation of a service for a design creates its row,
  in one `INSERT ... ON CONFLICT DO UPDATE`, and later reservations replace
  the previous document when their result arrives. Until then the previous
  document stays readable, with status `requested` or `processing`.
- **Input hash.** Each reservation records `input_hash`, the hash of the input
  of that generation as the adapter computes it (see "Input export"), so a
  save with an unchanged input runs nothing. An adapter without an input
  export records `NULL`.
- **Request.** `requested_at` and `requested_by` describe the latest request,
  not the first one.
- **Locked designs.** A design used by a launched activity (`designs.locked`)
  keeps its analyses as they are. It cannot be saved, so it requests nothing,
  and generating or editing answers `409 DESIGN_LOCKED`.

### Input export

A design-scoped adapter exports

```js
export function designAnalysisInput({ design, designCase }) {
    // null: the service does not apply to this design.
    // { input, hash }: what the generation works on, and the hash of
    // everything that determines its result.
}
```

It may be async. `design` is the saved design document. `designCase` is
`{ id, title, languageCode, contentHash }`, or `null` when the design has no
case (`helpers/design-analysis-input-helper.js`):

- `contentHash` is the SHA-256 of the case PDF (`sha256:<hex>`), which
  determines the case text. It is taken from the case's render job
  (`pdf_render_jobs.source_sha256`) or, without one, from the file, so it is
  available while the case is still rendering, and a copied case has the same
  one. It is `null` when the case has no readable PDF.
- The case text itself is not in `designCase`. A handler that needs it waits
  for it with `waitForCaseDocumentText(caseId)`
  (`helpers/case-document-render-helper.js`), as `mock-case-analysis` does.

The adapter computes `hash` with `hashAnalysisInput(value)`
(`helpers/analysis-input-hash.js`): the SHA-256 of the value's JSON with
sorted keys, as `sha256:<hex>`. The value covers everything the result depends
on, for example the case's `contentHash` and language and the selected
questions with their text hashes. It leaves out what differs between a design
and its copies, such as design and case ids, so a copy keeps the same hash.
`input` reaches the handler as `context.analysisInput`, together with
`context.inputHash`, so the handler works on exactly what was hashed.

The registry collects the export (`getDesignAnalysisInputBuilder(serviceId)`).
An adapter with the `design` scope and no export logs a warning: saving a
design never runs it, and an explicit generation runs it with `input_hash`
`NULL`.

### Producers, consumers and units

Design analyses are declared in the catalog (#863). A producer lists what it
stores under `produces`, and every adapter that needs that analysis lists the
same `{ documentSchema, unit }` under `consumes`:

| Adapter | Declaration |
| --- | --- |
| `case-analyst-claim-typology` | `produces: [{ documentSchema: "claim-typology/v1", unit: "question" }]` |
| `argumentation-tutor-system` | `consumes: [{ documentSchema: "claim-typology/v1", unit: "question" }]` |

A unit is the design element an analysis is about. The one unit so far is
`question`: a non-empty semantic differential question, as plain text.
Questions have no stable ids, so they are identified by position, 1-based as
at runtime: `phaseNumber` is `stages.number`, `questionNumber` is
`differential.orden`, and the id is `p<phaseNumber>-q<questionNumber>`. Each
question carries `textHash`, the SHA-256 of its text, so a result can tell
which questions changed.

A producer analyses only the units its consumers need.
`selectDesignAnalysisUnits({ producerId, design })`
(`helpers/design-analysis-units.js`) returns the questions of the phases that
enable at least one usable consumer of a schema the producer produces for the
unit:

1. `registry.getDesignAnalysisConsumerIds(producerId, { unit })` lists the
   registered adapters whose `consumes` matches one of the producer's
   `produces`. A development consumer counts only when development adapters
   are registered.
2. Consumers that no phase of the design enables are dropped; when none is
   left, the policy is not read.
3. `registry.usableServiceIds()` keeps the consumers the policy gate allows
   under the current version: their AI Additions services are allowed, the
   version does not switch them off (`disabledAdapterIds`, #864), and an AI
   Additions connection is stored (see "Usability").
4. A remaining consumer may need the analysis only in some phases, depending
   on the phase's configuration of it (#870). Its adapter says so by
   exporting `needsDesignAnalysis({ documentSchema, unit, configuration })`,
   where `configuration` is the phase's stored
   `externalServices.configurations[consumerId]` (`{}` when it has none);
   `registry.consumerNeedsDesignAnalysis(consumerId, { producerId, unit,
   configuration })` calls it for each schema the producer produces and the
   consumer consumes. An adapter without it, or one that throws, needs every
   phase that enables it. The catalog's `consumes` still declares what the
   consumer may need; the predicate only narrows it per phase. The tutor
   needs the claim typology only in phases whose requested mode is
   `enhanced` (see "The tutor's modes").
5. The questions of the phases that enable a remaining consumer that needs
   them are returned, in design order. A phase that enables a switched-off
   consumer and a usable one is selected, and so is a phase where one
   consumer does not need the analysis and another does.

Adding a consumer of an existing analysis is therefore a catalog change: its
phases join the producer's selection, and the producer's input hash changes
for designs that use it, so their next save runs the analysis again.
Switching a consumer off removes its phases the same way, and so does a
phase configuration that makes a consumer stop needing it: switching a tutor
phase to `basic` drops its questions from the claim typology, and switching
it back requests them again.

`explainDesignAnalysisUnits()` returns the same selection as `{ units,
reason, consumerIds }` (#865): `reason` says why nothing is selected
(`not-applicable` for a ranking design or an unknown unit, `no-consumer`,
`consumers-unusable` when the policy, a per-adapter switch or a missing
connection leaves no consumer usable, `no-questions`, and `not-needed` when
the consumers' phases have questions but no consumer needs them with the
phase's configuration, #870), and `consumerIds` are the usable consumers the
design enables, whether or not they need any unit. The design view reads both
through the analysis endpoint (see "API"), so the backend is the one source of
the selection.

`selectQuestionUnits(design, { serviceIds, needs })` and
`findQuestionUnit(design, position, { serviceIds })` select by enabled service
ids without the policy (`needs` is the optional per-phase predicate above).
The tutor finds its own question with them (`findTutorQuestion()` in
`adapters/ats-feedback.adapter.js`), and `mock-design-analysis` selects the
tutor's questions with them.

### Analyses on creation and save

`requestDesignAnalyses(designId, { trigger })`
(`helpers/design-analyses-lifecycle-helper.js`) runs in the background
(`scheduleDesignAnalyses()`) after `POST /designs` (`trigger: "created"`) and
`PATCH /designs/:id` (`trigger: "updated"`) answer, so creating or saving
never waits for it. It reads the design as stored and:

1. requests nothing for a locked design, a design whose document is not
   `valid: true`, or a design without a case;
2. takes the design-scoped services usable under the current policy version
   (`getUsableServiceIdsForScope("design")`) that export
   `designAnalysisInput()`;
3. asks each one for its input. A service that answers `null` does not apply
   and gets nothing;
4. reserves a generation with `reserveDesignAnalysisForSavedInput()`, which
   reserves nothing when the stored analysis has the same `input_hash` and
   either its generation is in flight (and not stale) or it is `ready` without
   an error. A ready analysis with an error keeps the document of an earlier
   input, so it is requested again, and so is a failed one;
5. dispatches the trigger's hook to that service only (`design-created` for
   a new design, `design-updated` for a saved one), under the job id of its
   reservation, with its `analysisInput` and `inputHash`.

A save with a changed input while a generation is in flight supersedes it:
the new reservation takes a new job id, and the older job's `markProcessing`,
`complete` and `fail` find no row. A save with the same input while one is in
flight does nothing. Errors of one service are logged and do not affect the
others or the save.

**Overlapping saves.** Preparing an input takes time (policy, case, adapter),
and job ids order reservations, not saves. Each reservation is therefore bound
to the design row its input was prepared from: the row's fingerprint
(`md5(design::text)`, computed by PostgreSQL from the stored jsonb on both
sides, see `designFingerprintSql()`) and its `case_id`. The reservation
statement locks that design row (`FOR SHARE`) and reserves nothing when the
row no longer matches or is locked (`designChanged: true`). Under READ
COMMITTED, a save's reservation always runs after its own update commits, so
an older save either reserves before the newer update and is superseded by
the newer save's reservation, or runs after it and is rejected. A rejected
save does nothing (outcome `design-changed`): the newer save owns the
analysis.

### Copies

Duplicating or importing a design (`POST /designs/:id/duplicate`) copies the
source's `ready` analyses to the copy, in the transaction that creates it
(`copyReadyDesignAnalyses()`): document, schema, input hash, request and
generation times, and the error of a latest generation that failed while
keeping the document. Job ids, requesters and review fields are not copied.
An activity launched right away from the copy therefore has its analyses.

After the copy is committed, it runs the same request as a save, as a new
design (`trigger: "created"`, so `design-created`), with the same binding to
the design row, so a save of the copy that overlaps it wins.
The copied case has the same PDF, so the input hash of a copied ready
analysis matches and nothing runs for it. Services that apply but had no
ready analysis on the source (in flight, failed, or never requested) are
requested for the copy. The copied case is also queued for rendering when it
has no render job (`ensureCasePdfRenderJob()`), so handlers can wait for its
text.

### Dispatch

Generations are dispatched with one of two hooks
(`helpers/design-analysis-hooks.js`), both in `NON_SESSION_HOOKS`, so they
follow the current policy version:

| Hook | `context.trigger` | Dispatched by |
| --- | --- | --- |
| `design-created` | `created` | `POST /designs`, and a copy (duplicate or import) |
| `design-updated` | `updated` | `PATCH /designs/:id` |
| `design-updated` | `generate` | `POST /designs/:id/analyses/:serviceId/generate`, with the current design |

`dispatchDesignHook(context, { reservations })` takes the hook from
`context.trigger` (`designHookForTrigger()`), sends it to each reserved
service under the job id of its reservation and releases a reservation its
adapter did not start, as `case-created` does. An adapter that treats new and
edited designs alike subscribes to both hooks (`DESIGN_ANALYSIS_HOOKS`), as
both design adapters do. The input hash, superseding and the binding to the
design row behave the same for both.

### Development adapter

`mock-design-analysis` (development only) applies to designs with a case and
at least one tutor question (`selectQuestionUnits()` with
`argumentation-tutor-system`, whatever the policy). Its input is the case's language and
`contentHash` and the selected tutor questions, and its `mock-design-analysis/v1`
document holds `phaseCount` (tutor phases with questions), `questionCount` and
`questions` (`id`, `phaseNumber`, `questionNumber`, `text`, `textHash`,
`wordCount`). It calls no external service, so it exercises analyses on save,
unchanged saves, copies and regeneration locally.

### Claim typology adapter

`case-analyst-claim-typology` (`adapters/case-analyst-claim-typology.adapter.js`,
#849) stores Case Analyst's claim typology (ethicapp-ai-additions#192) as a
design analysis: the plausible types of answer to each selected question,
which the Argumentation Tutor uses when it gives feedback. It requires
`case-analyst`, has the `design` scope and produces `claim-typology/v1` per
question; its callbacks come from the `case-analyst-api` Keycloak client.

- **Input.** `designAnalysisInput()` applies to designs with a case and at
  least one selected question: a question of a phase that enables a usable
  consumer of claim typologies (`selectDesignAnalysisUnits()`, see
  "Producers, consumers and units"). With the shipped catalog these are the
  questions of the tutor's phases, while the current policy allows
  `argumentation-tutor-system` and does not switch it off. Case Analyst accepts 1 to 30 questions, so
  a design with more sends its first 30, in design order, and logs a warning.
  When the case has an evidence inventory (its `case-analyst-evidence-inventory`
  analysis holds an `evidence-inventory/v1` document, whatever the status of a
  generation in flight), the input carries it.
- **Hash.** The case language as Case Analyst receives it (`es_CL` for `es`
  and `es_*`, `en_US` otherwise), the case `contentHash`, each question's id
  and text hash, and the hash of the inventory document. A copy of the design
  keeps the hash; an edited question, a new case PDF, or a regenerated or
  edited inventory changes it, so the next valid save runs the typology again.
- **Request.** The `design-created` and `design-updated` handlers (the same
  one) start the generation, wait for the case text
  (`waitForCaseDocumentText()`) and send one
  `POST /claim-typologies` with `basePath: "/case-analyst/api/v1"`: a
  `claim-typology-request/v1` with `case{id, title, text, language}`,
  `questions[{id: "p<phase>-q<question>", phaseId: <phase number>, text}]`,
  the optional `evidenceInventory` and
  `clientContext{service, correlationId: <job id>, designId, caseId,
  questionTextHashes}`. The job stays `dispatched` until the callback.
- **Callback.** A completed `claim-typology-result/v1` is stored with
  `documentSchema: "claim-typology/v1"`. Case Analyst returns `clientContext`
  unchanged, and the adapter adds to each typology `questionTextHash`, the
  hash of the question text it answers, taken from
  `clientContext.questionTextHashes` (null when missing). A failed result is
  recorded with Case Analyst's sanitized message. A
  callback that matches no job is refused by the registry, since the adapter
  exports no `getCallbackTarget()`.
- **Errors.** The adapters' shared codes (see "Error codes" under "Case
  Analyses"): the render outcomes (`no-document`, `render-failed`,
  `superseded`, `timeout`), `empty-case-text`, `case-text-too-long` (over
  200,000 characters), `request-rejected` (a 4xx), `request-failed` (no
  connection, a network error or a 5xx), `service-<code>` for a failed result
  (the core codes the result schema names, such as `llm_refused`, map to
  their public code; unknown ones are `service-internal-error`),
  `invalid-result` and `adapter-error`.

The teacher's design view shows the typology read-only
(`components/claim-typology-panel.component.js` and
`claim-typology-questions.component.js` in the frontend). The panel shows the
generation state and "Generate again"; each question the typology covers
shows its focal action and claim types (stance, description, example
statement and cited evidence, with the statements of the case's current
evidence inventory) inside its phase, and the tutor's expected mode (see
"The tutor's modes"). The questions, their text hashes and the expected modes
come from `GET /designs/:id/analyses/:serviceId` (#865); the frontend selects
and hashes nothing. A typology whose `questionTextHash` differs from the
unit's `textHash`, or that records none, is marked out of date. When nothing
is selected the panel says why: with the tutor switched off, for example, it
lists no question as awaiting a typology. "Generate" is offered only while
units are selected and the typology service itself is usable.

### The tutor's modes

The Argumentation Tutor adapter (`adapters/ats-feedback.adapter.js`, #850)
opens one tutor session per EthicApp session, phase and question, so each
answer is evaluated against its own question. Each session runs in one of two
modes (#865, epic #861; ethicapp-ai-additions#209):

- **Enhanced:** the session receives the case's evidence inventory and the
  question's claim typology as `case_context`. The tutor checks the
  argument's evidence against the case's facts and classifies its claim.
- **Basic:** the session receives no context, and the tutor evaluates as it
  did before #647.

The teacher chooses the requested mode per phase (#870), and EthicApp
decides the effective mode from it. The effective mode is fixed when the
session is created and kept until the phase ends; an input that arrives later
does not upgrade a running session.

- **The setting.** It is the tutor's own instance configuration field
  `evaluation_mode` (`enhanced` | `basic`, default `enhanced`,
  ethicapp-ai-additions#211), stored like any other phase setting in
  `phase.externalServices.configurations["argumentation-tutor-system"]`. The
  design editor shows it with the descriptor-driven form ("Modo de
  evaluación": "Mejorado" / "Básico", or "Evaluation Mode": "Enhanced" /
  "Basic", from the descriptor's own translations), with no bespoke UI.
  Saving validates it against the descriptor ("Configuration validation"),
  and copies keep it ("Copies"). A phase without a stored value requests
  `enhanced`, the descriptor's default (`requestedTutorMode()` and
  `DEFAULT_REQUESTED_TUTOR_MODE` in `helpers/tutor-mode.js`).
- **`enhanced`**, or no value, selects the mode automatically by the rule
  below, with its fallback to basic.
- **`basic`** runs basic on purpose: the reason is `basic-selected`, before
  any other; the session receives no `case_context`; and the phase's
  questions need no claim typology, so the typology is not generated for
  them (the tutor adapter's `needsDesignAnalysis()`, see "Producers,
  consumers and units").

- **Session key.** The first response to a question creates its session. The
  key is `<sessionId>:<phaseId>:<question key>`, where the question key is the
  positional id `p<stages.number>-q<differential.orden>`
  (`tutorQuestionKey()`), or `question-<runtime id>` when the runtime question
  does not map to a position (for example a ranking item). The submission
  counters that choose between a first analysis and a comparison are kept per
  question and student, so a student's second answer to a question is
  compared with their first answer to the same question. `phase-ended`
  deletes the sessions of every question of the phase.
- **Question text.** The session's `question` is the design's question at that
  position as plain text (`findTutorQuestion()`, a question unit of
  `helpers/design-analysis-units.js`), the same text the typology answers.
  Without one it is the runtime question's text, then the phase's first
  question, then its instructions, as before #850.
- **The rule.** `decideTutorMode(inputs, question, { requestedMode })` in
  `helpers/tutor-mode.js` is the one place that decides the mode, for session
  creation and for the design view alike. A phase that requests `basic` is
  `basic-selected`. Otherwise a question runs enhanced when the case's
  `case-analyst-evidence-inventory` analysis has a document, the design's
  `case-analyst-claim-typology` analysis has a typology for the question
  whose `questionTextHash` matches the question text, and both adapters are
  usable under the AI service policy, including their per-adapter switches
  (#864). A document kept while a new generation is in flight, or after a
  failed one, is used under the same conditions. A session follows the policy
  version it is pinned to, as its hooks do; the design view follows the
  current one.
- **Reasons.** Otherwise the session runs basic, and the reason is the first
  that applies, in this order. The inventory comes first: a case without one
  cannot run enhanced whatever its typologies.

  | Reason | When |
  | --- | --- |
  | `basic-selected` | The phase requests the basic mode (`evaluation_mode: basic`, #870). A choice, not a fallback. |
  | `inventory-disabled` | The evidence inventory adapter is switched off, or its service is not allowed. |
  | `inventory-failed` | The case has no inventory because its generation failed or never answered, or it could not be read. |
  | `no-inventory` | The case has no inventory (case analyses are chosen when the case is created). |
  | `typology-disabled` | The claim typology adapter is switched off, or its service is not allowed. |
  | `typology-pending` | The question has no usable typology and a generation is in flight. |
  | `typology-failed` | The question has no usable typology and the latest generation failed or never answered, or the typology could not be read or used. |
  | `typology-out-of-date` | The question's typology answers another text of the question, or records none. |
  | `no-typology` | The question has no typology (including a response that maps to no tutor question). |
  | `tutor-unsupported` | The tutor answered without a `mode`: it predates ethicapp-ai-additions#209 and ignored the context. |
  | `context-rejected` | The tutor answered `400 {"error": "Invalid case context"}`, or created the session in the basic mode anyway. |

  The last two are known only from the tutor's answer to session creation;
  `inventory-disabled` and `typology-disabled` were added to the reasons of
  #865 for the per-adapter switches of #864.
- **Request.** In the enhanced mode the session body carries `case_context`
  (`tutor-case-context/v1`): `evidenceInventory` is the stored
  `evidence-inventory/v1` document as is, and `claimTypology` the question's
  typology as `tutor-claim-typology/v1` (`toTutorClaimTypology()` in
  `helpers/tutor-claim-typology.js`): `schemaVersion`, `focalAction` and at
  most eight `types[{id, label, description, stance, exampleStatement?,
  relatedEvidenceIds?}]` with unique ids and a known stance. Cited facts the
  inventory does not have are left out; `relatedFacts`, `questionId`,
  `phaseId` and `questionTextHash` are not sent. In the basic mode the body
  has no context. The deprecated top-level `claim_typology` is never sent: the
  tutor answers 400 when it comes with `case_context` or `evaluation_mode`.

  ```json
  {
    "case_id": "ethicapp-case-57",
    "case_title": "...",
    "case_text": "...",
    "question": "...",
    "case_context": {
      "schemaVersion": "tutor-case-context/v1",
      "evidenceInventory": { "schemaVersion": "evidence-inventory/v1", "facts": ["..."], "exclusions": ["..."] },
      "claimTypology": {
        "schemaVersion": "tutor-claim-typology/v1",
        "focalAction": "tell his mother about the accident",
        "types": [
          { "id": "AF1", "label": "Tell her now", "description": "...",
            "stance": "in_favor", "relatedEvidenceIds": ["EV3"] }
        ]
      }
    }
  }
  ```
- **Requested mode.** The body also carries `evaluation_mode`, the phase's
  requested mode (`enhanced` for a phase without a stored value), when the
  tutor's capability descriptor declares the field (#870). The descriptor is
  read through the registry's cached `getServiceInstanceConfiguration()`
  under the session's pinned policy version. A tutor that predates
  ethicapp-ai-additions#211 would report the field as `unsupported` with
  `degraded: true`, so it is not sent the field at all; a `basic` phase still
  sends it no context. The stored value itself is never copied into the
  body: the decision sends `basic` or `enhanced`, and keeps it when a
  rejected `llm_tier` makes the session be created again with the tutor's
  defaults. The tutor answers:

  | Sent | Tutor's answer |
  | --- | --- |
  | `evaluation_mode: basic`, no context | `requestedMode: "basic"`, `mode: "basic"`, `missing: []` |
  | `evaluation_mode: enhanced` with a complete context | `requestedMode` and `mode` both `enhanced` |
  | `evaluation_mode: enhanced`, parts missing or no context | `mode: "basic"` and `missing` |
  | `evaluation_mode: basic` with a context (never sent) | `400 {"error": "Conflicting evaluation mode"}` |
  | neither the field nor a context | as before ethicapp-ai-additions#211, with no mode keys |
- **Fallbacks.** When the tutor answers `400` naming the case context, the
  session is created again without it (`context-rejected`). A tutor that
  answers without `mode` ignored the context (`tutor-unsupported`); the next
  sessions are created without one for ten minutes
  (`CASE_CONTEXT_UNSUPPORTED_RETRY_MS`), and also report `tutor-unsupported`.
  Each of these two outcomes is logged once per process. A failure to read
  the inputs never fails the response: the session runs basic.
- **Report.** The instantiation report of the response that created the
  session carries `questionKey`, `requestedMode` (the phase's requested mode,
  #870), `tutorMode` (the effective mode, `enhanced` or `basic`) and
  `tutorModeReason` (null in the enhanced mode). When a context was offered,
  `caseContext` says what became of it (`used`, `rejected` with
  `caseContextRejection`, `downgraded` or `unsupported`). `tutorModeMissing`
  lists the parts the tutor reported missing, and `tutorRequestedMode` is the
  `requestedMode` the tutor echoed, when it reports them.
- **Evaluations.** The tutor's result callback carries, at the top level of
  its payload, `claimTypeId` (`AF#` or null) and `claimTypeRationale` (up to
  600 characters) when the session has a typology, and `tutorMode` in every
  analysis of a session opened with `case_context` or `evaluation_mode`, with
  `requestedMode` (the session's `evaluation_mode`, #870) and, in the
  enhanced mode, `evidenceFactIds` (`EV#`) and `unsupportedClaims`
  (`{ statement, exclusionId }`, at most 10). The `callback-received` handler
  records them in the result's `adapter_result` (`external_service_results`,
  next to the raw payload). The feedback published to the student keeps its
  shape and never includes them.
- **Teachers.** The design view shows, per tutor question, the mode it can
  expect as of now: "Advanced evaluation available", or "The tutor will
  evaluate without the advanced capabilities" with the reason, and a link to
  the case or to generate the typology again when that helps. A phase set to
  basic shows instead a neutral note, "El tutor evaluará en modo básico,
  según la configuración de la fase" ("The tutor will evaluate in the basic
  mode, as the phase's settings choose";
  `[data-testid="tutor-mode-phase-note"][data-tutor-mode-reason="basic-selected"]`),
  and its questions are not listed as awaiting a typology. The activity view
  warns, per tutor question with a session that fell back to the basic mode,
  with the reason (`[data-testid="tutor-mode-warning"]`); sessions whose
  phase chose it get one neutral note per phase instead
  (`[data-testid="tutor-mode-basic-selected"]`). It reads
  `GET /activities/:session_id/tutor-modes` again whenever the registry
  announces a new tutor session (`onExternalServiceInstantiated`).

`GET /activities/:session_id/tutor-modes` (`controllers/activity-tutor-modes.js`,
`helpers/tutor-mode-records.js`) is for the activity's creator only: students
get `403` and other teachers `404 SESSION_NOT_FOUND`. It returns the latest
report of each phase and question, with the evaluations recorded for that
question by the mode the tutor reported:

```json
{
  "status": "ok",
  "result": {
    "sessionId": 7,
    "questions": [
      {
        "phaseId": 31, "phaseNumber": 1, "questionId": 88,
        "questionKey": "p1-q2", "questionNumber": 2,
        "requestedMode": "enhanced",
        "tutorMode": "basic", "tutorModeReason": "no-inventory",
        "createdAt": "2026-10-27T14:00:00.000Z",
        "evaluations": { "enhanced": 0, "basic": 3, "unreported": 0 }
      },
      {
        "phaseId": 32, "phaseNumber": 2, "questionId": 91,
        "questionKey": "p2-q1", "questionNumber": 1,
        "requestedMode": "basic",
        "tutorMode": "basic", "tutorModeReason": "basic-selected",
        "createdAt": "2026-10-27T14:05:00.000Z",
        "evaluations": { "enhanced": 0, "basic": 2, "unreported": 0 }
      }
    ]
  }
}
```

`requestedMode` is null for sessions created before #870. The tutor reports a
mode in every evaluation of a session opened with `case_context` or
`evaluation_mode`, so with a tutor that declares `evaluation_mode` the
evaluations of basic sessions count by mode. Only evaluations of sessions
opened with neither (an older tutor, or sessions from before #870) report no
mode and count as `unreported`.

#### Comparing modes in a study

The mode is a per-phase design setting, so a study compares groups by
activity, not inside one activity:

1. Duplicate the design (`POST /designs/:id/duplicate`); the copy keeps every
   phase's settings, including `evaluation_mode`.
2. In the copy, change the tutor's evaluation mode of the phases under study,
   and save. Switching a phase to `basic` drops its questions from the claim
   typology; switching it to `enhanced` requests them.
3. Launch one activity per group, each from its design.
4. Read `GET /activities/:id/tutor-modes` for each activity: `requestedMode`
   and `tutorMode` per question tell "chose basic" (`basic-selected`) from
   "fell back to basic" (any other reason), and `evaluations` counts the
   evaluations by the mode the tutor reported. The evaluations themselves,
   with `tutorMode` and `requestedMode`, are in
   `external_service_results.adapter_result`.

Assigning modes to groups of students inside one activity is out of scope.

### The tutor's report columns

The tutor adapter subscribes to `report-building` (#948, see "Report
building") and adds `ats_` columns to the responses report
(`adapters/ats-feedback.report.js`); it adds nothing to the chat transcript.
It reads only its stored `student-response-submitted` results, whose
`raw_payload` is the tutor's callback payload, and never calls the tutor.

| Column | Holds |
| --- | --- |
| `ats_mode` | `analysis` or `comparison` |
| `ats_tutor_mode` | `enhanced` or `basic`, the mode the tutor reported |
| `ats_requested_mode` | `enhanced` or `basic`, the mode the phase requested |
| `ats_feedback_title`, `ats_feedback_summary` | The feedback's title and summary |
| `ats_feedback_bullets` | The feedback's points, one per line |
| `ats_claim`, `ats_evidence`, `ats_warrant`, `ats_qualifier` | The criterion scores: the claim's position (-1, 0 or 1), the others 0 to 3 |
| `ats_claim_type` | The claim type the tutor matched (`AF#`) |
| `ats_unsupported_claims` | How many unsupported claims the tutor found |
| `ats_feedback_count` | How many results reached the row |
| `ats_feedback_time` | When the shown result was received (ISO 8601) |

- Only `completed` and `callback-received` results count; `failed` ones were
  refused or not processed.
- A result goes to the row of the response its job recorded as its source
  (#946). It is ignored when that response is not in the report or belongs to
  another user. A result without a source, from a job created before V38,
  goes to the row with the same phase, question and user, only when exactly
  one row has them.
- When several results reach a row (a first analysis, then comparisons), the
  row shows the latest by `receivedAt`, whole, and `ats_feedback_count` says
  how many there were. A comparison reports no claim type, tutor mode or
  unsupported claims, so those fields are empty when the latest is one.
- The student's argument (`argumentPreview`, the `comparison` texts) and the
  claim type's rationale are not exported; the report's `comment` column
  already holds the response. A field the result does not report is empty.
- Results of a forgotten user are redacted as stored (V31) and appear so.

### The tutor's student feedback

The tutor adapter publishes each evaluation to its student as a
`student-result/v1` document (epic #1124, #1133), through the document form
of `publishStudentResult` (see "Student result documents"), and rebuilds the
same document through `student-results-reading`. The tutor declares the
schema for the `response` scope in its descriptor's `student_outputs`
(ethicapp-ai-additions#233). The code is `buildStudentFeedback()` in
`adapters/ats-feedback.utils.js`, which both paths call.

**The activity's locale.** Every tutor session is created with a `locale`
session input, the language the tutor writes the student's feedback in. It
comes from the activity's design, `designs.language_code`, by the canonical
rule (`activityLocale()`): Spanish (`es`, `es_*`) is `es_CL`, any other
language `en_US`, and a design without a language `es_CL`, the column
default. The Polyadic bridge reads the same column for its own `locale`. The
locale is derived for each session and never stored in a design. The tutor
reports it back as a BCP 47 tag, which the instantiation report keeps as
`locale`. A tutor that predates ethicapp-ai-additions#233 reports the key as
an unsupported setting (`degraded: true`). A tutor that refuses it with
`400 {"error": "Invalid locale"}` gets the session again without it, and the
report holds its answer as `localeRejection`.

**The document.** For each callback:

- When the payload carries `studentResult` and the document passes the
  schema checks of `validateStudentResultDocument()`, it is published
  unchanged, as `{ documentSchema: "student-result/v1", document }`, with its
  criterion descriptions and overview.
- Otherwise, as for callbacks stored before ethicapp-ai-additions#235, the
  legacy keys (`summary`, `criteria`, `bullets`, `argumentPreview`,
  `comparison`) are mapped to a document by `legacyStudentDocument()`. The
  mapping follows the tutor's own builder: its titles, section titles,
  labels (`Afirmación`, `Evidencia`, `Garantía`, `Calificador` in `es-CL`;
  `Claim`, `Evidence`, `Warrant`, `Qualifier` in `en-US`) and values
  (`A favor`, `2 de 3`, `No disponible`), in the activity's locale, without
  descriptions or overview. A score outside 1 to 3 reads as not available and
  makes the document `partial`; a payload with no criteria is `unavailable`.
  The tutor's English placeholder summary is left out. Summaries and bullets
  are the model's text, in whatever language the model wrote. A
  `studentResult` that fails the checks is logged as
  `The tutor's student document fails EthicApp's checks` with codes and
  paths only.

The event's `message` is a fixed text in the document's locale. The
teacher-only keys of the payload (`claimTypeId`, `claimTypeRationale`,
`tutorMode`, `requestedMode`, `evidenceFactIds`, `unsupportedClaims`) are
read only into the stored outcome; the document schema is closed and the
registry emits only the document and its ids.

**Live and rebuilt.** The callback's stored outcome records
`studentDocument: { source, locale }` (`source` is `tutor` or `legacy`) next to
`feedbackTitle`, which is now the document's title. The rebuild maps a legacy
payload in that recorded locale, so it equals the document published live
even if the design's language changes later. Callbacks processed before
#1133 have no recorded locale and were never published as documents; the
rebuild maps them in the activity's locale, which the registry passes as
`context.locale`, or `es-CL` when it could not be read. The handler reads
nothing but its stored results. A tutor document needs no locale.

**Release order.** The tutor release with ethicapp-ai-additions#235 is
deployed before this adapter: EthicApp sends a document only when the
service declares its schema, and an older tutor declares none, so its
documents (mapped or not) would be refused.

### Recording results from an adapter

`register()` receives `designAnalyses`, bound to the adapter's own service, with
the same contract as `caseAnalyses`:

- `markProcessing({ designId, jobId })` starts the generation reserved under
  the `jobId` of the hook context. Await it before the `design-created` or
  `design-updated` handler settles. It returns `null` when the generation is no longer the reserved one
  or the context has no `jobId`; the adapter must then skip the work.
- `complete({ jobId, documentSchema, document })` stores the document, which
  replaces the previous one.
- `fail({ jobId, errorCode, errorMessage })` records a failed generation and
  keeps an existing document.

An adapter may export
`validateDesignAnalysisDocument(document, { designId, caseId, languageCode, design })`,
which returns `{ document, documentSchema }` or `{ errors }`, to accept teacher
edits. No adapter exports it for now: analyses of designs are read-only in epic
#846.

### API

Only the design creator can use these endpoints: students get `403` and other
teachers `404 DESIGN_NOT_FOUND`, also for public designs.

| Endpoint | Description |
| --- | --- |
| `GET /designs/:id/analyses` | The design's analyses with status and timestamps, without documents. |
| `GET /designs/:id/analyses/:serviceId` | One analysis with what the design view renders next to it (#865): `{ analysis, units, unitsReason, producerUsable, tutorModes, tutorPhases }`. `analysis` is the analysis with its document, or `null` while a design service has produced nothing for the design. `units` are the units the service currently selects (`{ id, phaseNumber, questionNumber, text, textHash }`, see "Producers, consumers and units"), `unitsReason` why there are none (else `null`), `producerUsable` whether the service could generate now, `tutorModes` the expected tutor mode of each tutor question when the tutor is a usable consumer, including the questions of phases set to basic, which are not units (`{ "p1-q1": { "mode": "basic", "reason": "typology-out-of-date", "requestedMode": "enhanced" } }`, see "The tutor's modes"), and `tutorPhases`, under the same condition, the mode each tutor phase requests (`[{ "phaseNumber": 2, "requestedMode": "basic", "reason": "basic-selected" }]`, `reason` null for `enhanced`; else `[]`, #870). `404 DESIGN_ANALYSIS_NOT_FOUND` when the service does not analyse designs and the design has no analysis from it. |
| `PUT /designs/:id/analyses/:serviceId` | Body `{ document }`, validated by the adapter. Answers `405 DESIGN_ANALYSIS_NOT_EDITABLE` without a validator (every service today), `409 DESIGN_LOCKED` on a locked design, `400 DESIGN_ANALYSIS_DOCUMENT_INVALID` with `details`, and `409 DESIGN_ANALYSIS_PROCESSING` while a generation is in flight. |
| `POST /designs/:id/analyses/:serviceId/generate` | Reserves a new generation with the input hash of the service's `designAnalysisInput()`, sends `design-updated` (`trigger: "generate"`, with the current design) to that service only, and answers `202` with the reserved analysis. It runs whatever the stored input hash. Answers `404 DESIGN_ANALYSIS_SERVICE_NOT_FOUND` when the service is not registered with the `design` scope, `409 DESIGN_LOCKED` on a locked design, `503 DESIGN_ANALYSIS_SERVICE_DISABLED` when the service is not usable, `409 DESIGN_ANALYSIS_NOT_APPLICABLE` when its input export answers `null` for the design, `409 DESIGN_CHANGED` when a save changed (or a launch locked) the design while the input was prepared (try again), and `409 DESIGN_ANALYSIS_PROCESSING` while a generation is in flight. It also recovers stale generations. |

## AI Additions Authentication

EthicApp talks to AI Additions centrally through
`../services/ai-additions-client.service.js`.

### The connection

Where AI Additions is comes from the AI Additions connection stored in the
database (`ai_additions_connection`, #813), not from environment variables. The
client reads it through `helpers/ai-service-policy.js#getConnection` and reuses
it for 5 seconds. Every URL derives from it (`helpers/ai-additions-connection.js`):

| URL | Derivation |
| --- | --- |
| Token endpoint | `base_url/keycloak/realms/<realm>/protocol/openid-connect/token` |
| JWKS (callback verification) | `base_url/keycloak/realms/<realm>/protocol/openid-connect/certs` |
| Expected callback issuer | `<keycloak_public_url or base_url/keycloak>/realms/<realm>` |
| Service APIs | `base_url` + the adapter's API path (`/polyadic-agent/api`, `/argumentation-tutor/api/v2`, `/case-analyst/api/v1`) |
| Capability descriptors | `base_url` + the catalog's `descriptor.path` |

EthicApp reaches Keycloak through `base_url` because the public Keycloak URL
may not be reachable from inside the container. `keycloak_public_url` only sets
the issuer EthicApp expects: with a fixed `KC_HOSTNAME`, Keycloak issues the
same `iss` whatever host a request comes through. `<realm>` is
`AI_ADDITIONS_KEYCLOAK_REALM`.

**Without a connection nothing is called.** Every client call rejects with
`AiAdditionsNotConfiguredError` (`code: "not_configured"`, test it with
`isAiAdditionsNotConfigured(error)`) before any request leaves the host,
authenticated or not (`AI_ADDITIONS_POLYADIC_AGENTS_AUTHENTICATED=false`
included). Adapters let it fail their job; descriptors report
`{ available: false, reason: "not_configured" }`; callbacks are rejected with
`503` and `code: "not_configured"`, because their tokens cannot be verified
without the connection and removing the connection stops all AI traffic.

When the connection changes, the cached token is dropped, cached descriptors
no longer apply, and the callback verifier drops its JWKS keys. JWKS keys and
pending JWKS fetches are kept per URL, so a response from the previous host
can never verify tokens for the current one.

### The client

The client uses the Keycloak client credentials flow and:

- caches access tokens per connection until shortly before expiry;
- uses one snapshot of the connection per request attempt for both the URL and
  the token, so a token is never sent to a host other than the one that issued
  it; if the connection changes while the token is obtained, the attempt
  restarts;
- coalesces concurrent token requests;
- adds the `Authorization: Bearer ...` header to authenticated requests;
- retries once after `401` by clearing the cached token.

Its public API:

| Member | Purpose |
| --- | --- |
| `requestJson(pathname, { method, body, headers, basePath, authenticated, timeoutMs })` | JSON request to `base_url + basePath + pathname`. Paths must be relative; absolute URLs are refused. |
| `getAccessToken()` | A bearer token for the current connection. |
| `getEndpoints()` | `{ baseUrl, realm, tokenUrl, jwksUrl, issuer, fingerprint }` for the current connection. |
| `resolveServiceUrl(...segments)` | `base_url` joined with relative segments. |
| `getConnectionFingerprint()` | Changes when the connection does; `null` without one. |
| `withConnection({ baseUrl, keycloakPublicUrl })` | A client bound to an unsaved connection, with its own token cache, for a connection test. |

All of them reject with `not_configured` without a connection (except
`getConnectionFingerprint`, which returns `null`). Database errors while reading
the connection propagate unchanged.

Adapters must not implement Keycloak token negotiation directly. Use the injected
`aiAdditionsClient` with the service's API path:

```js
const response = await aiAdditionsClient.requestJson("/sessions", {
    method:   "POST",
    basePath: "/my-service/api/v1",
    body:     { example: true },
});
```

Set `authenticated: false` only for explicitly public AI Additions endpoints.

## Environment Variables

### Outbound authentication (EthicApp → AI Additions)

| Variable | Purpose |
| --- | --- |
| `AI_ADDITIONS_HTTP_TIMEOUT_MS` | HTTP timeout for token and service requests. Defaults to `12000`. |
| `AI_ADDITIONS_KEYCLOAK_REALM` | Keycloak realm. Defaults to `ethicapp-ai-additions`. |
| `AI_ADDITIONS_KEYCLOAK_CLIENT_ID` | Confidential client id used by EthicApp. Required for authenticated calls. |
| `AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET` | Confidential client secret used by EthicApp. Required for authenticated calls. |
| `AI_ADDITIONS_KEYCLOAK_SCOPE` | Optional token scope. |

### Inbound callback authentication (AI Additions → EthicApp)

| Variable | Purpose |
| --- | --- |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_ENABLED` | Set to `false` to disable JWT validation in development. Defaults to `true`. The connection is then not read. |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_AUDIENCE` | Expected `aud` claim. Defaults to `ethicapp-ai-services` (the audience injected by the Keycloak mapper in AI Additions). Leave empty to skip audience check. |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_CLOCK_TOLERANCE_SECONDS` | Clock skew tolerance for `exp`/`nbf` validation. Defaults to `30`. |

The issuer and JWKS URL derive from the connection (see above).

### Polyadic Agents

| Variable | Purpose |
| --- | --- |
| `AI_ADDITIONS_POLYADIC_AGENTS_AUTHENTICATED` | Whether Polyadic requests carry a bearer token. Defaults to `true`. Unauthenticated requests still need the connection. |
| `AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE` | Fallback pipeline for phases whose design does not configure one. |

The Case Analyst adapter is currently a skeleton: it builds the analysis
request for every case that chose it and completes the job without calling the
provider or recording a case analysis (it fails the job with `not_configured`
when no connection is stored). Submission and result handling are the next
increments.

Argumentation Tutor completion is callback-driven. EthicApp submits the task and
keeps the external-service job dispatched until the correlated `result` callback
arrives; it does not poll the ATS task-status endpoint.

When adding, removing, or renaming variables, update the repository deployment
contract in `../../../deploy/env.contract.yml` and the relevant `.env.example`
files.

## AI Additions Facade Contract

EthicApp calls AI Additions through its gateway (`base_url`), not through
internal container ports. `base_url` may be a Docker-internal name or an
external HTTPS host. In a co-located staging deployment, AI Additions can listen
only on localhost while EthicApp remains public; the connection's `base_url` is
then the local gateway, for example `http://127.0.0.1:8010`, and
`keycloak_public_url` is the public Keycloak URL AI Additions publishes as its
issuer (`KEYCLOAK_PUBLIC_URL`).

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
{ "username": "...", "content": "...", "participant_id": "<sender uid>",
  "ethicapp_correlation_id": "<correlationId>" }
```

`participant_id` is the sender's EthicApp user id as a string (#876). Polyadic
stores it with the message and never shows it to the agents; its
per-participant erasure finds the messages by it.

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
3. Add a service entry to `manifest.json` with its hook list, `callbackAuth`,
   `requires` (add a new AI Additions service id to `AI_ADDITIONS_SERVICE_IDS`
   in `catalog.js` first), and the `response` scope if the service processes
   student responses. Mark a mock with `development: true` and `requires: []`
   (see "The adapter catalog"), and declare the documents it publishes to
   students in `studentOutputs` (see "Student result documents").
4. Use `aiAdditionsClient.requestJson()` for AI Additions HTTP calls and forward
   `context.correlationId` in outbound requests.
5. Pass the service's API path as `basePath`; never read a URL from the
   environment. Every URL derives from the AI Additions connection.
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
