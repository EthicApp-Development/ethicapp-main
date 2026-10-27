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
| Session hooks (`phase-started`, `phase-ended`, `activity-started`, `activity-finished`, `student-response-submitted`, `chat-message-received`, and any hook other than `case-created` and `design-saved`) | The version the session was pinned to at launch (`sessions.ai_service_policy_version_id`), found from `context.sessionId`. A hook without `sessionId` follows no version. |
| `case-created` (`NON_SESSION_HOOKS`) | The current version. It only bounds the author's choice (`case_analyses`): the candidates are the services chosen for the case, never every allowed one. |
| `design-saved` (`NON_SESSION_HOOKS`) | The current version. Only the reserved design analyses receive it (see "Design Analyses"). |
| `GET /external-services`, `GET /external-services/:id/instance-configuration`, design saving, the case form's choice (`POST /cases`), regenerating a case or design analysis | The current version. |
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
| `design-saved` | After `POST /designs` and `PATCH /designs/:id` answer, after `POST /designs/:id/duplicate` (duplicate or import) commits the copy, and from `POST /designs/:id/analyses/:serviceId/generate` (`helpers/design-analyses-lifecycle-helper.js`) | Each design-scoped service whose generation was reserved, one dispatch per service (see "Design Analyses") | `designId`, `userId` (requester), `caseId`, `languageCode` (the case's), `design` (the design document), `analysisInput` and `inputHash` (from the service's `designAnalysisInput()`) |
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

**Design hooks (reserved generations).** `design-saved` reaches only the
design-scoped services whose generation was reserved in `design_analyses`
(`dispatchDesignSavedHook(context, { reservations })`, see "Design Analyses"),
in the same way.

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
  tags each warning with its `room`. The Argumentation Tutor adds `llmTier`,
  the resolved `model`, the `questionKey` of the session and what became of
  the question's claim typology (see "The tutor and the claim typology").
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
| `GET /cases/:id/analyses/:serviceId` | One analysis with its document. |
| `PUT /cases/:id/analyses/:serviceId` | Body `{ document }`, validated by the adapter. Answers `405 CASE_ANALYSIS_NOT_EDITABLE` without a validator, `400 CASE_ANALYSIS_DOCUMENT_INVALID` with `details`, and `409 CASE_ANALYSIS_PROCESSING` while a generation is in flight. Records `reviewed_at` and `reviewed_by`. |
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

AngularJS cannot load a component named by the manifest, so the frontend keeps
an allowlist from `ui.component` to registered components
(`CASE_ANALYSIS_COMPONENTS` in `ethicapp/frontend/assets/js/helpers/case-analyses.js`).
A service whose component is missing or not in the allowlist gets the generic
panel, which shows the document's fields read-only. Either way the tab shows
the status, the latest error and "Generate again" (with a confirmation), which
is offered only when the service is `usable`.

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

- **No choice in advance.** Teachers choose nothing: saving a design requests
  the analyses of every design-scoped service that applies (see "Analyses on
  save"). The first reservation of a service for a design creates its row,
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

`helpers/design-tutor-questions.js` selects the questions the Argumentation
Tutor discusses (`selectTutorQuestions(design)`): the non-empty semantic
differential questions of the phases that enable `argumentation-tutor-system`,
as plain text. Questions have no stable ids, so they are identified by
position, 1-based as at runtime: `phaseNumber` is `stages.number`,
`questionNumber` is `differential.orden`, and the id is
`p<phaseNumber>-q<questionNumber>`. Each question carries `textHash`, the
SHA-256 of its text, so a result can tell which questions changed.

### Analyses on save

`requestDesignAnalysesOnSave(designId)`
(`helpers/design-analyses-lifecycle-helper.js`) runs in the background
(`scheduleDesignAnalysesOnSave()`) after `POST /designs` and
`PATCH /designs/:id` answer, so saving never waits for it. It reads the
design as stored and:

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
5. dispatches `design-saved` to that service only, under the job id of its
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

After the copy is committed, it runs the same request as a save, with the
same binding to the design row, so a save of the copy that overlaps it wins.
The copied case has the same PDF, so the input hash of a copied ready
analysis matches and nothing runs for it. Services that apply but had no
ready analysis on the source (in flight, failed, or never requested) are
requested for the copy. The copied case is also queued for rendering when it
has no render job (`ensureCasePdfRenderJob()`), so handlers can wait for its
text.

### Dispatch

Generations are dispatched with the `design-saved` hook, one of
`NON_SESSION_HOOKS`, so it follows the current policy version.
`dispatchDesignSavedHook(context, { reservations })` sends it to each reserved
service under the job id of its reservation and releases a reservation its
adapter did not start, as `case-created` does.

### Development adapter

`mock-design-analysis` (development only) applies to designs with a case and
at least one tutor question. Its input is the case's language and
`contentHash` and the selected tutor questions, and its `mock-design-analysis/v1`
document holds `phaseCount` (tutor phases with questions), `questionCount` and
`questions` (`id`, `phaseNumber`, `questionNumber`, `text`, `textHash`,
`wordCount`). It calls no external service, so it exercises analyses on save,
unchanged saves, copies and regeneration locally.

### Claim typology adapter

`case-analyst-claim-typology` (`adapters/case-analyst-claim-typology.adapter.js`,
#849) stores Case Analyst's claim typology (ethicapp-ai-additions#192) as a
design analysis: the plausible types of answer to each tutor question, which
the Argumentation Tutor uses when it gives feedback. It requires
`case-analyst` and has the `design` scope; its callbacks come from the
`case-analyst-api` Keycloak client.

- **Input.** `designAnalysisInput()` applies to designs with a case and at
  least one tutor question (`selectTutorQuestions()`), and only while the
  current policy also allows `argumentation-tutor-system`
  (`registry.isServiceUsable()`). Case Analyst accepts 1 to 30 questions, so
  a design with more sends its first 30, in design order, and logs a warning.
  When the case has an evidence inventory (its `case-analyst-evidence-inventory`
  analysis holds an `evidence-inventory/v1` document, whatever the status of a
  generation in flight), the input carries it.
- **Hash.** The case language as Case Analyst receives it (`es_CL` for `es`
  and `es_*`, `en_US` otherwise), the case `contentHash`, each question's id
  and text hash, and the hash of the inventory document. A copy of the design
  keeps the hash; an edited question, a new case PDF, or a regenerated or
  edited inventory changes it, so the next valid save runs the typology again.
- **Request.** The `design-saved` handler starts the generation, waits for the
  case text (`waitForCaseDocumentText()`) and sends one
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
generation state and "Generate again"; each tutor question shows its focal
action and claim types (stance, description, example statement and cited
evidence, with the statements of the case's current evidence inventory)
inside its phase. A typology whose `questionTextHash` differs from the hash of
the current question text is marked out of date.

### The tutor and the claim typology

The Argumentation Tutor adapter (`adapters/ats-feedback.adapter.js`, #850)
opens one tutor session per EthicApp session, phase and question, so each
answer is evaluated against its own question.

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
  position as plain text (`findTutorQuestion()` in
  `helpers/design-tutor-questions.js`), the same text the typology answers.
  Without one it is the runtime question's text, then the phase's first
  question, then its instructions, as before #850.
- **Typology.** When the design's `case-analyst-claim-typology` analysis holds
  a typology for that question whose `questionTextHash` matches the hash of
  the question text, the session receives it as `claim_typology`
  (`helpers/tutor-claim-typology.js`). A document kept while a new generation
  is in flight is used under the same condition. The tutor's
  `tutor-claim-typology/v1` (ethicapp-ai-additions#204) accepts no other key,
  so the adapter sends `schemaVersion`, `focalAction`, at most eight
  `types[{id, label, description, stance, exampleStatement?,
  relatedEvidenceIds?}]` with unique ids and a known stance, and
  `relatedFacts[{id, statement}]` with the facts of the case's evidence
  inventory that those types cite. Cited facts the current inventory no longer
  has are left out. `questionId`, `phaseId` and `questionTextHash` are not
  sent.

  ```json
  {
    "schemaVersion": "tutor-claim-typology/v1",
    "focalAction": "tell his mother about the accident",
    "types": [
      { "id": "AF1", "label": "Tell her now", "description": "...",
        "stance": "in_favor", "relatedEvidenceIds": ["EV3"] }
    ],
    "relatedFacts": [{ "id": "EV3", "statement": "..." }]
  }
  ```
- **Fallbacks.** A design without the analysis, a question without a
  typology, an out-of-date typology or a failure to read it creates the
  session as before, without the field. When the tutor answers
  `400 {"error": "Invalid claim typology"}`, the session is created again
  without it. A tutor that predates #204 reports `claim_typology` as an
  unsupported setting and ignores it; a session whose answer lacks
  `claim_typology_used: true` counts as such, and the next sessions are
  created without a typology for ten minutes
  (`CLAIM_TYPOLOGY_UNSUPPORTED_RETRY_MS`). Each of these two outcomes is
  logged once per process.
- **Report.** The instantiation report of the response that created the
  session carries `questionKey` and `claimTypology`: `used`, `rejected` (with
  `claimTypologyRejection`), `unsupported`, `withheld` (not offered during
  the ten minutes) or `absent`, with `claimTypologyReason` (`no-question`,
  `no-analysis`, `no-typology`, `out-of-date`, `invalid` or `load-failed`).
- **Evaluations.** With a typology, the tutor's result callback carries
  `claimTypeId` (`AF#` or null) and `claimTypeRationale` (up to 600
  characters) at the top level of its payload. The `callback-received`
  handler records both in the result's `adapter_result`
  (`external_service_results`, next to the raw payload). The feedback
  published to the student keeps its shape and never includes them. No
  teacher screen shows them yet.

### Recording results from an adapter

`register()` receives `designAnalyses`, bound to the adapter's own service, with
the same contract as `caseAnalyses`:

- `markProcessing({ designId, jobId })` starts the generation reserved under
  the `jobId` of the hook context. Await it before the `design-saved` handler
  settles. It returns `null` when the generation is no longer the reserved one
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
| `GET /designs/:id/analyses/:serviceId` | One analysis with its document. `404 DESIGN_ANALYSIS_NOT_FOUND` when the design has none from that service. |
| `PUT /designs/:id/analyses/:serviceId` | Body `{ document }`, validated by the adapter. Answers `405 DESIGN_ANALYSIS_NOT_EDITABLE` without a validator (every service today), `409 DESIGN_LOCKED` on a locked design, `400 DESIGN_ANALYSIS_DOCUMENT_INVALID` with `details`, and `409 DESIGN_ANALYSIS_PROCESSING` while a generation is in flight. |
| `POST /designs/:id/analyses/:serviceId/generate` | Reserves a new generation with the input hash of the service's `designAnalysisInput()`, sends `design-saved` to that service only, and answers `202` with the reserved analysis. It runs whatever the stored input hash. Answers `404 DESIGN_ANALYSIS_SERVICE_NOT_FOUND` when the service is not registered with the `design` scope, `409 DESIGN_LOCKED` on a locked design, `503 DESIGN_ANALYSIS_SERVICE_DISABLED` when the service is not usable, `409 DESIGN_ANALYSIS_NOT_APPLICABLE` when its input export answers `null` for the design, `409 DESIGN_CHANGED` when a save changed (or a launch locked) the design while the input was prepared (try again), and `409 DESIGN_ANALYSIS_PROCESSING` while a generation is in flight. It also recovers stale generations. |

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
