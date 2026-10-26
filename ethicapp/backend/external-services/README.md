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
  `docker-compose.yml` sets it.

Registering only subscribes handlers: it makes no outbound call
(`__tests__/registration.node-test.mjs`). Whether a registered adapter
receives events is decided at dispatch, by the registry's policy gate (see
"Usability").

### Usability: the AI service policy gate

`registry.effectiveServiceIds(requestedIds, policyVersion)` is the one place
that decides whether an adapter may receive events (#815, epic #810):

- **Production adapters** pass when every AI Additions service in their
  `requires` is in `policyVersion.allowedServiceIds` and a usable AI Additions
  connection is stored. "Usable" means a row exists and its URLs are valid
  (`isValidAiAdditionsUrl` in `helpers/ai-additions-connection.js`; see
  "Stored connection URLs" below). The connection is read through the AI
  Additions client (`isConfigured()`, 5 s cache), and a failed read counts as
  no connection.
- **Development adapters** (the mocks, `requires: []`) need no AI Additions
  service, so they pass whenever they are registered, which only happens with
  `EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true`, whatever the policy or the
  connection. Production installations never register them.

Which version applies:

| Path | Version |
| --- | --- |
| Session hooks (`phase-started`, `phase-ended`, `activity-started`, `activity-finished`, `student-response-submitted`, `chat-message-received`, and any hook other than `case-created`) | The version the session was pinned to at launch (`sessions.ai_service_policy_version_id`), found from `context.sessionId`. A hook without `sessionId` follows no version. |
| `case-created` (`NON_SESSION_HOOKS`) | The current version. It only bounds the author's choice (`case_analyses`): the candidates are the services chosen for the case, never every allowed one. |
| `GET /external-services`, `GET /external-services/:id/instance-configuration`, design saving, the case form's choice (`POST /cases`), regenerating a case analysis | The current version. |
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
   `pending` or `open`; a closed or failed one refuses them with `409`
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
- Case Analyst: none. Its handler only records the result, so it only accepts
  callbacks for its jobs.

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
| `closed` | `phase-ended` for its phase, `activity-finished` for its session, or a newer room job of the same room opened (superseded) | `409` |
| `failed` | The room could not be created | `409` |

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
- `phase-ended` and `activity-finished` close the room jobs first, from the
  database, so rooms this process no longer tracks are closed too.

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
| `scopes` | no | Where the service operates: `case` (case documents), `response` (student responses) or `chat` (group chat). Defaults to `[]`. Unknown values are dropped with a warning and duplicates are removed. Screens list services by scope (see "Listing services"), so an entry without scopes appears in none of them; `__tests__/manifest.node-test.mjs` requires at least one. |
| `ui` | no | `{ component }`: the kebab-case name of the EthicApp frontend component that will show the service's analysis in the case view. Defaults to `{ component: null }`; other names are dropped with a warning. The texts come from the adapter, not from the manifest (see "UI translations"). |
| `descriptor` | no | `{ path }`: the capability descriptor the service's AI backend publishes (#687). Its id (`service.id` in the descriptor) is the one AI Additions service in `requires`, so an adapter with a descriptor requires exactly one service; `descriptor.serviceId` is no longer accepted (#812). That id may differ from `id`: ids are mapped, not renamed, so stored designs, chat agents and jobs keep the manifest id. `path` is the descriptor route relative to the AI Additions connection's `base_url`, for example `/polyadic-agent/api/capabilities`; it must be an absolute path without host, query or `..` segments. An invalid path is dropped with a warning. `GET /external-services` exposes `descriptor.serviceId` and a summary (see "Listing services"); the route stays internal (`getServiceDescriptor()`). |
| `capabilities` | — | Removed (#726). Entries that still declare it log a deprecation warning and the key is ignored. A service that processes student responses declares the `response` scope instead; the student app shows the processing state for those services. |
| `enabled` | — | Removed (#812). An entry that declares it rejects the catalog; usability is decided at dispatch (see "Usability"). |
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
    service,                 // normalized manifest entry (id, description, hooks, globalHooks, scopes, ui, descriptor, requires, development, adapter, callbackAuth)
    subscribe,               // (hookName, handler) => void
    publishStudentResult,    // (payload) => Promise<boolean>
    publishGroupChatMessage, // (payload) => Promise<{ savedMessage, notificationPayload } | null>
    aiAdditionsClient,       // shared AI Additions HTTP client
    caseAnalyses,            // markProcessing/complete/fail for this service's case analyses
    roomJobs,                // create/open/fail/close for this service's room jobs (see "Room jobs")
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
optional `getUiTranslations` (see "UI translations") and
`validateCaseAnalysisDocument` (see "Case Analyses") are part of the registry
contract. The adapter should subscribe only to hooks it handles.

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
  constants, as `case-analyst` does until Case Analyst publishes them.
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
  usesLlm, locale, fields }`, or `{ available: false, reason }` with `reason`
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
- **Cache.** In memory, per process, keyed by service and descriptor locale.
  A valid descriptor is kept for ten minutes. After a failure the result is
  kept for a minute before asking again; if an earlier fetch succeeded, its
  fields are served meanwhile with `stale: true`. Concurrent calls share one
  request. Nothing is stored in Redis.

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
`?scope=response&scope=chat`, so services that only work on cases are not
offered as phase options.

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

Every hook handler receives `(context, { callback, reportInstantiation })`:

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
| `activity-started` | `POST /activities/:id/phase_transition` when the session enters `in_progress` (first phase only, see `helpers/activity-lifecycle-helper.js`) | Services enabled for the started phase | `sessionId`, `phaseId`, `startedPhaseId`, `endedPhaseId` |
| `phase-started` | Every phase transition | Services enabled for the started phase | `sessionId`, `phaseId` (= started), `startedPhaseId`, `endedPhaseId` |
| `phase-ended` | Phase transition, when a different phase was active before | Services enabled for the ended phase | `sessionId`, `phaseId` (= ended), `startedPhaseId`, `endedPhaseId` |
| `activity-finished` | `POST /activities/:id/finish` | Union of services enabled in any phase of the design | `sessionId`, `phaseId` (= last active), `startedPhaseId: null`, `endedPhaseId` |
| `student-response-submitted` | Student response endpoints in `controllers/activities/activities-student.js` | Services enabled for the phase | `sessionId`, `phaseId`, `userId`, `questionId`, `designType`, `requestPayload`, `responsePayload` |
| `chat-message-received` | `controllers/group-messages.js` after a group chat message is saved | Services enabled for the phase | `sessionId`, `phaseId`, `questionId`, `groupId`, `userId`, `parentId`, `content`, `savedMessage`, `notificationPayload`, `designType` |
| `case-created` | `POST /cases` after the case, authors, tags, analyses, and render job are persisted, and `POST /cases/:id/analyses/:serviceId/generate` (`helpers/case-lifecycle-helper.js`) | Services chosen for the case when it was created; generate reaches one of them | `caseId`, `caseUuid`, `userId` (creator), `title`, `pdfPath`, `languageCode`, `visibility`, `pdfRenderJobId` |
| `callback-received` | `POST /external-services/callbacks` | Only the service named in the callback body | `serviceId`, `eventType`, `correlationId`, `eventId`, `requestPayload`, `rawBody`, `auth` |

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

**Case hooks (case creation opt-in).** `case-created` reaches the services the
teacher chose when creating the case (`analysisServiceIds`, see "Case
Analyses"): `dispatchCaseCreatedHook(context, { reservations })` dispatches each
reserved analysis to its service only (`enabledServiceIds`), under the job id of
its reservation (`jobIds`). A case created without a choice dispatches nothing,
and editing the case never changes the choice.

**Global hooks (manifest opt-in).** Hooks that fire outside an activity and
need no teacher choice are dispatched with
`registry.dispatchGlobalHook(hookName, context)`. Its audience is
every service whose catalog entry lists `hookName` in `globalHooks`, filtered
by the policy gate like any other dispatch. Opting in is decided in
the catalog; there is no teacher-facing UI for it. `dispatchGlobalHook` delegates to `dispatchHook`, so jobs,
`correlationId`, `callback(result)` handling, and error isolation are identical.

No hook uses this path today: `case-created` did until the services became a
choice of each case (#649).

`globalHooks` is only consulted by `dispatchGlobalHook`. Listing a phase-scoped
hook such as `phase-started` there has no effect, because the activity dispatch
sites never read it.

Jobs created by case and global hooks have `session_id`, `phase_id`,
`question_id`, and `group_id` set to `NULL`. Use the `hookName` filter of
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
as `jobId` and `correlationId` in the handler context. A caller that reserved
work under a job id beforehand passes `jobIds` (service id to job id) in the
dispatch options: the job is created under that id, and the handler receives
it even when the row cannot be created.

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
  tags each warning with its `room`. The Argumentation Tutor adds `llmTier` and
  the resolved `model`.
- A report with warnings, degraded mode or rejected settings is also logged as
  one `[external-services] Instantiation report.` line with its job id.
- `NULL` means the job instantiated nothing. Teachers do not see these reports
  yet.

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
  `false` otherwise.
- `publishGroupChatMessage(payload)`: saves a message authored by the external
  service and publishes chat notifications to the group and the teacher. The
  payload must include `content`, `phaseId`, `questionId`, and `groupId`;
  `sessionId`, `parentId`, and `agentDisplayName` are optional but should be
  provided when available. The agent identity is upserted in
  `external_service_agents` by `serviceId`. Returns
  `{ savedMessage, notificationPayload }` or `null` when the payload is
  incomplete or the message could not be saved.

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
only, under the reserved job ids. Editing, importing, or duplicating a case
never changes or requests analyses.

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
results of superseded jobs are ignored and return `null`. An adapter that hits
an unexpected error after starting a generation calls `fail`, as the mock does,
so the analysis does not stay `processing` until it is stale.

`case-created` fires before the PDF worker extracts the case text. Adapters that
need it wait with `waitForCaseDocumentText(caseId)` from
`helpers/case-document-render-helper.js`, which returns `ready` with the text,
or `no-document`, `render-failed`, `superseded`, or `timeout`. The wait runs in
the web process: a restart drops it and leaves the analysis `processing` until
it is stale, and generating again recovers it.

### Teacher edits

An adapter may export
`validateCaseAnalysisDocument(document, { caseId, languageCode, getCaseText })`.
It returns `{ document, documentSchema }` with the document to store, or
`{ errors }`. Services without it accept no edits.

### API

Only the case creator can use these endpoints: students get `403` and other
teachers `404 CASE_NOT_FOUND`. Services not chosen for the case answer
`404 CASE_ANALYSIS_NOT_FOUND`.

| Endpoint | Description |
| --- | --- |
| `GET /cases/:id/analyses` | The chosen services with status and timestamps, without documents. |
| `GET /cases/:id/analyses/:serviceId` | One analysis with its document. |
| `PUT /cases/:id/analyses/:serviceId` | Body `{ document }`, validated by the adapter. Answers `405 CASE_ANALYSIS_NOT_EDITABLE` without a validator, `400 CASE_ANALYSIS_DOCUMENT_INVALID` with `details`, and `409 CASE_ANALYSIS_PROCESSING` while a generation is in flight. Records `reviewed_at` and `reviewed_by`. |
| `POST /cases/:id/analyses/:serviceId/generate` | Reserves a new generation, replays `case-created` for that service only, and answers `202` with the reserved analysis. Answers `409 CASE_ANALYSIS_PROCESSING` while a generation is in flight and `503 CASE_ANALYSIS_SERVICE_DISABLED` when the service is disabled. It also recovers stale generations. |

`mock-case-analysis` (`adapters/mock-case-analysis.adapter.js`) is the reference
implementation: it runs in the web process, counts the words of the case, and
stores an excerpt.

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
3. Add a service entry to `manifest.json` with its hook list, `callbackAuth`,
   `requires` (add a new AI Additions service id to `AI_ADDITIONS_SERVICE_IDS`
   in `catalog.js` first), and the `response` scope if the service processes
   student responses. Mark a mock with `development: true` and `requires: []`
   (see "The adapter catalog").
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
