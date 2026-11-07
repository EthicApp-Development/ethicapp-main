# Changelog

This file lists every published release of EthicApp, newest first.

A release is four things with one name:
- a git tag;
- its entry here;
- a GitHub Release with the same text;
- the images published under the same tag in GitHub Container Registry
  (`ghcr.io/ethicapp-development/ethicapp*`).

A partial release publishes only some images. A deployment keeps the other
images on their previous tags.

To find which release a container runs, read its labels:

```sh
docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' <container>
docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' <container>
```

Images published before this file existed have no version label of their
own; the migrations images show the version of their Flyway base image
(11.20.3). For those images, the image tag is the release.

Versions are dates: `vYYYY.MM.DD`, with `.1`, `.2` for later releases on the
same day.

Until `v2026.10.25` there were two lines of releases. Tags ending in `-esa`
were built from the `external-services-architecture` branch for the esa
staging target. The other tags were built from `main`. Below, both lines
appear in the order they were published, and each `-esa` entry names its
branch.

The entries up to `v2026.11.05` were written in November 2026. They come from
three sources:
- the git history;
- the revision labels of the published images;
- the deployment records of `ethicapp-deployment`.

Entries for May and June 2026 are brief. EthicApp 1.0 and 2.0 (2023) are older
than this file; see their GitHub Releases.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [v2026.11.07] - 2026-11-07

Results for students as versioned, localized documents, a student activity view that stays current when its socket fails, and Polyadic guide names in the student chat (epics #1123, #1124, #1025).

### Added

- The student's activity state keeps the external services' results, and results shown to students follow the `student-result/v1` contract. EthicApp keeps a verbatim copy of the schema and examples in `canonical-schemas/ai-additions/`, validates each document against it, and shows a document only when the service declared that schema for the scope (#1123, #1124).
- The student chat names each Polyadic message's author with the guide's name in that room: the teacher's nickname, or "agente" or "agent" by the room's language (#1026, epic #1025).
- When the student's socket fails, the activity view polls for changes (after 15 s and 30 s, then every 60 s), shows a notice, and offers an "Actualizar actividad" button that holds off repeated clicks; after a reconnect it rejoins the activity's rooms (#626, #1108).

### Changed

- Releases have a `CHANGELOG.md` and a GitHub Release, images carry `org.opencontainers.image.version`, and `scripts/ghcr-build-push.sh` builds a release tag only from a clean checkout of that tag (#110, #111).

### Fixed

- Results stored between the student's first load and the socket's first connection appear once the socket has joined the student's room (#1143).
- Every case copy path queues the copy's render by one rule and copies its files, authors, tags, videos and documents the same way (#1088, #1089).
- Reports keep the Polyadic agent names of a forgotten student's replies (#1155).
- Under `vite` and `vite preview`, the auth, management console and student apps load the logo, favicons, manifest and font from `nginx/static`, and NGINX serves the logos under the `/auth/` and `/mng/` prefixes (#999).

### Security

- The student's `full_state` no longer returns other groups' chat messages (#1122).
- The student app's socket handlers log ids only (#1139).

### Deployment

- Migrations: V44 (`V44__keep_agent_names_in_redacted_payloads.sql`): the redaction of a forgotten student's payloads keeps the string values of `agente` and `agentName`. Run it with this release's `management-console`, which applies the same rule.
- Environment contract: unchanged.
- Deploy after ethicapp-ai-additions v2026.11.07-ai-additions: the student documents need the Argumentation Tutor with ethicapp-ai-additions#235, and the guide names need Polyadic Agents with ethicapp-ai-additions#249. Rooms open during the deployment keep the "@agente" nickname until they close.
- The application Redis keys `chatMessages:*` are no longer read and expire within 300 s (#1122).

## [v2026.11.05] - 2026-11-05

Teacher home in the Actividades design (epic #1093).

Partial release: only the `ethicapp` image.

### Added

- The teacher home lists "Actividades en curso" (five rows) and "Terminadas
  recientemente" (three rows) with the Actividades table, row actions, notices
  and empty page (#1121, epic #1093).

### Changed

- The launcher is one row of tiles, and the home no longer scrolls sideways
  (#1121).
- Shared `ActivityRowActionsService` and the `activity-action-notice`,
  `activities-table` and `activities-empty-page` components (#1104, #1103,
  #1119); `activity-description` trimmed to what the dashboard uses (#1120).

### Deployment

- Migrations: none.
- Environment contract: unchanged.

## [v2026.11.04.1] - 2026-11-04

Sign-up email help and "check your email" notice (auth-backend hotfix, #1090 via #1091).

Hotfix superseding v2026.11.04. Partial release: only the `auth-backend` image.

### Changed

- The sign-up form's email field has a help text asking for a careful address, and after sign-up a "Revisa tu correo" notice replaces the form, showing the address with "Corregir mi correo" and "Pide un enlace nuevo", and no longer redirects (#1090).

### Deployment

- Migrations: none.
- Environment contract: unchanged.

## [v2026.11.04] - 2026-11-04

Actividades page, RUT retired, case copy fixes (epics #1046, #1067).

### Added

- "Actividades" is an activity management page with the tabs "En curso", "Terminadas" and "Archivadas", search and status filters kept in the URL, archive and restore with notices and "Deshacer", and a page for a teacher with no activities (#1049 to #1053, epic #1046).
- Teachers can add AI analyses to an existing case or remove one, and copies of a case inherit its ready analyses (#1038, #1039, #1040).

### Changed

- An activity records when it ends (`sessions.finished_at`), and only a finished activity can be archived: `PATCH /activities/:session_id/archive` replaces `toggle_archived` and answers 409 `ACTIVITY_NOT_FINISHED` otherwise (#1047, #1048, epic #1046).
- Teacher-facing texts say "participantes" instead of "estudiantes" (#1054, epic #1046).
- A unique, case-insensitive email identifies an account: sign-up, login, the bootstrap scripts, the console's search and anonymization, the report exports and the privacy policy no longer collect, read or show the RUT, and users who signed in with their RUT must use their email (#1068 to #1072, epic #1067).
- The login page sends a signed-in visitor to their home, and the student app sends professors and administrators to theirs, its backend answering 403 to non-student roles (#1064, #1065, #1066).

### Fixed

- `PATCH /designs/:id/toggle_public` ignores its old `publishCase` and `publishCaseCopy` flags (#1009).
- Importing a design copies its case with the source's license and rights details (#1085).

### Deployment

- Migrations: V41, V42 and V43 (V42 stops without changes if two accounts' emails differ only in letter case; V43 drops `users.rut` and its values).
- Environment contract: removes `ADMIN_DNI`.
- Before deploying, back up the database, which is the only copy of the RUT values after V43, and run the "Case-Insensitive Emails" and "Archived Activities" queries of `deploy/README.md`. Rolling back after V43 means restoring that backup, since earlier releases read `users.rut`.

## [v2026.11.03] - 2026-11-03

Casos management page and service contributions in reports (epics #1008, #620).

### Added

- "Casos" is a case management page with the tabs "Mis casos", "Compartidos por otros" and "Archivados", search and status filters, a delete confirmation that lists the designs losing the case, and notices with "Deshacer"; importing a shared case stays on its tab (#1013, #1015, #1016, #1017, epic #1008).
- The case view shows the case's uses and the tabs "Texto del caso", "Material" and "Derechos", and "Nuevo diseño con este caso" opens the design form with the case selected (#1012, #1018, #1019, epic #1008).
- The responses report adds 14 `ats_` columns with the Argumentation Tutor's feedback, and the chat transcript adds four `polyadic_` columns for agent messages plus rows for evaluations Polyadic Agents did not publish (#944 to #949, epic #620).

### Changed

- A case in use can change its sharing, through the new `PATCH /cases/:id/sharing`, and a case that other teachers' designs use cannot be deleted (409) (#1010, #1014, epic #1008).

### Fixed

- Deleting a case that has copies works, where it answered 500; the copies keep existing (#1010, epic #1008).

### Deployment

- Migrations: V38, V39 and V40 (V38 and V39 add nullable columns linking hook jobs and agent chat messages to their sources; V40 makes the case copy links `ON DELETE SET NULL`).
- Environment contract: unchanged.

## [v2026.11.02.1] - 2026-11-02

Sign-up password labels restored (auth-backend hotfix, #997 via #998).

Hotfix superseding v2026.11.02. Partial release: only the `auth-backend` image.

### Fixed

- The sign-up form's password and password confirmation fields show their labels again: the auth frontend sets component defaults with default parameters, which React 19 applies, and a lint rule rejects `defaultProps` (#997).

### Deployment

- Migrations: none.
- Environment contract: unchanged.

## [v2026.11.02] - 2026-11-02

Account closure and per-user erasure, access checks, teacher dashboard, launch wizard and designs page (epics #879, #923, #892, #965, #966).

### Added

- Account administration in the management console: confirm a pending account, delete one that was never activated, set a student's or a teacher's password, and forget a student or a teacher. Forgetting a teacher first finishes their open activities, forgetting anyone also erases what the Argumentation Tutor and Polyadic Agents keep about them, and administrator actions are recorded (#874 to #878, #880, #881, #889, epic #879).
- The teacher activity dashboard puts students' responses first, with a sticky activity bar, a phase navigator, a side panel for response details and an option to hide students' names behind pseudonym numbers (#893 to #897, epic #892).
- "Lanzar actividad" is a two-step wizard: choose a design, then give a required description and review the design's AI services, with a switch to turn them off for that activity (#967 to #973, epic #965).
- "Diseños" is a design management page with the tabs "Mis diseños", "Compartidos por otros" and "Archivados", filters, an import state per shared design and a delete confirmation; a design with copies can be deleted (#963, #974 to #979, epic #966).

### Fixed

- Starting the next phase runs in one server transaction, and an activity has at most one phase per number (#906, epic #892).
- Students can reopen a finished activity, which answered 404 (#872).

### Security

- Owner and role checks on the activity, phase, group, design, case and student-state endpoints; a resource the caller may not see answers 404 like a missing one, and a design can no longer point at another teacher's private case (#905, #910, #924 to #929, #934, #939, epic #923).
- Dependency updates for known vulnerabilities: `ejs` 7, `npm audit fix` in ten lockfiles, and multer, body-parser and nodemailer (#822, #823, #884, #899, #900).

### Deployment

- Migrations: V27, V28 and V30 to V37; there is no V29. V33 adds `UNIQUE (sesid, number)` to `stages` after deleting duplicate phases that hold no data, and stops if two duplicates both hold data.
- Environment contract: no variables added or removed; `STUDENT_ANONYMIZATION_PLACEHOLDER_TEXT` is now also passed to `management-console`, which must use the same value as the scheduled anonymization job.
- Before deploying, run the read-only "Phase Numbers" and "Design Case Associations" queries of `deploy/README.md` on the database and resolve any rows they return.
- Deploy with ethicapp-ai-additions v2026.11.02-ai-additions, AI Additions first: its per-user erasure endpoints must exist before an administrator forgets a student or a teacher.

## [v2026.10.28] - 2026-10-28

Tutor modes and declarative design analyses (epic #861).

### Added

- The Argumentation Tutor runs enhanced, with the case's evidence inventory and the question's claim typology, when both are available, and falls back to basic otherwise; the design and activity views tell teachers why (#865, epic #861).
- Teachers choose the tutor's evaluation mode per phase ("Modo de evaluación"), enhanced by default; the requested and the effective mode are recorded per tutor session and per evaluation (#870, epic #861).
- AI service policy versions can switch individual adapters off, and the console groups adapters by scope (#864, epic #861).

### Changed

- The `design-created` and `design-updated` hooks replace `design-saved` (#862, epic #861).
- Design analyses declare producers and consumers in the adapter catalog, and the claim typology covers only the questions of phases with a usable consumer (#863, epic #861).

### Deployment

- Migrations: V26 (adds `ai_service_policy_versions.disabled_adapter_ids`; existing policy versions keep every adapter on).
- Environment contract: unchanged.
- Deploy with ethicapp-ai-additions v2026.10.28-ai-additions, which the tutor modes require; deploy AI Additions first.

## [v2026.10.27] - 2026-10-27

Case and design AI analyses with Case Analyst (epics #647, #843, #846).

### Added

- The case creation form offers the AI analyses the current policy allows, off by default, and the case view shows the case text and one tab per chosen analysis (#650, #651, epic #647).
- Case Analyst adapters for three case analyses: the case evaluation, read-only, and the evidence inventory and topic listing, which the teacher can edit (#652, #844, #845, epic #647).
- Design analyses are stored per design and run when a valid design is saved, skipping an unchanged input; the first is Case Analyst's claim typology for each Argumentation Tutor question (#847, #848, #849, epic #846).
- The Argumentation Tutor opens one session per question, with that question's own text and, when available, its claim typology (#850, epic #846).

### Changed

- Saving or removing the AI Additions connection and saving an AI service policy version in the management console require the administrator's password or passkey (#841, epic #810).

### Fixed

- In the management console, a wrong administrator password no longer redirects to the login page, and a passkey that auth-backend rejects answers 401 instead of 500 (#841).

### Deployment

- Migrations: V25 (`design_analyses`).
- Environment contract: unchanged.
- After deploying, save a new AI service policy version in `/mng/ai-services` that allows `case-analyst` and `argumentation-tutor`; the claim typology runs only when the tutor is also allowed.
- Deploy with ethicapp-ai-additions v2026.10.27-ai-additions, AI Additions first; that release adds the Case Analyst service these analyses call.

## [v2026.10.26] - 2026-10-26

Operator-configured AI services (epic #810).

### Added

- The management console's AI services page (`/mng/ai-services`) stores the AI Additions connection, tests it (token, token issuer and catalog) and saves append-only AI service policy versions with the allowed services (#816, #817, #834, #838, epic #810).
- Each activity is pinned to the policy version current at its launch; a hook reaches an adapter only when that version allows every AI Additions service the adapter requires and a valid connection exists, and teachers see only the allowed services (#813, #815, epic #810).
- Room-scoped jobs for Polyadic Agents' proactive callbacks, so a callback without a hook job is accepted only for a room with an open room job (#833, epic #810).
- Cases store per-case AI analysis choices with a generic storage and API (`/cases/:id/analyses`); the case form offers the choice from v2026.10.27, so cases created under this release get no analyses (#649, epic #647).

### Changed

- The AI Additions client, the adapters, the capability descriptors and callback verification derive every URL from the stored connection, and the URL variables are removed with no fallback (#814, epic #810).
- The external-services manifest is one adapter catalog without `enabled`: each adapter declares the AI Additions services it requires, and the mock adapters register only with `EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true` (#812, epic #810).
- `INSTALL.md` documents installing without AI, the default, and enabling AI through the console (#818, #836).

### Deployment

- Migrations: V21, V22, V23 and V24 (V22 creates AI service policy version 1, which allows nothing, and pins every existing session to it).
- Environment contract: adds `EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS`; removes `AI_ADDITIONS_BASE_URL`, `AI_ADDITIONS_KEYCLOAK_BASE_URL`, `AI_ADDITIONS_KEYCLOAK_TOKEN_URL`, `AI_ADDITIONS_ARGUMENTATION_TUTOR_API_BASE_URL`, `AI_ADDITIONS_CASE_ANALYST_API_BASE_URL`, `AI_ADDITIONS_POLYADIC_AGENTS_API_BASE_URL`, `EXTERNAL_SERVICES_CALLBACK_AUTH_ISSUER`, `EXTERNAL_SERVICES_CALLBACK_AUTH_JWKS_URL` and `EXTERNAL_SERVICES_MANIFEST`. No new secrets.
- After deploying, a super-admin enters the AI Additions connection in `/mng/ai-services`, runs the connection test and saves a policy version that allows the services. Until then the installation uses no AI, and activities running at deploy time keep none; relaunch them to use AI.
- Deploy with ethicapp-ai-additions v2026.10.26-ai-additions, AI Additions first: the console reads its service catalog, and Polyadic Agents echoes the room correlation id the room jobs need.

## [v2026.10.25] - 2026-10-26

First release from main after merging the external-services-architecture branch, with no AI service enabled by default (#820, #821, epic #810).

### Changed

- main carries the work released on the external-services-architecture line up to v2026.10.24.1-esa: external AI services configured per phase, the application Redis, the session join in ethicapp-student, rich text, case videos and case documents (#820, #821).
- The default external-services manifest enables no AI service, and a service without `enabled` is disabled; `manifest.staging.json` and `manifest.development.json` are unchanged (#811, #819, epic #810).
- Dependabot updates of axios, vite, proxy-addr, brace-expansion, follow-redirects, fast-uri, source-map-js and postcss-selector-parser, and main's authorization fixes, reach the merged code through #820 (#645, #646, #653, #671, #679, #680, #684, #685, #688 to #696, #703, #716).

### Deployment

- Migrations: none compared with v2026.10.24.1-esa.
- Environment contract: unchanged (the description of `EXTERNAL_SERVICES_MANIFEST` changes).
- An installation coming from v2026.10.21 applies migrations V14 to V20, renames its `REDIS_SESSION_*` values to `REDIS_APP_*` and serves that Redis as `redis-app`, and updates its contract copy, which adds optional AI, video, document and console variables.
- An installation that wants AI services sets `EXTERNAL_SERVICES_MANIFEST` to a manifest that enables them; without it, Polyadic Agents and the Argumentation Tutor are no longer offered.

## [v2026.10.24.1-esa] - 2026-10-25

Public Google Drive documents attached to cases (epic #789).

Built from the external-services-architecture branch for esa staging.

### Added

- The case form's "Documentos anexos" section attaches public Google documents (Docs, Sheets, Slides and other Drive files such as PDFs, shared with anyone with the link or published to the web), with a preview and sharing guidance (#791, #793, epic #789).
- EthicApp checks each document through the Drive API, or with an anonymous request for published links, and caches the result briefly in the cache Redis (#791).
- The teacher case page, the activity case tab and the student case tab list the documents under "Material complementario"; each opens in a new tab, and a document that stops being available shows no link to students and shows teachers how to fix its sharing (#794).
- Cases store their documents, and the case API and copy paths carry them (#792).

### Fixed

- The "YouTube" label keeps its own height in the case form's and the editor's video rows (#804).

### Deployment

- Migrations: V20 (creates `ethical_case_documents`).
- Environment contract: adds `GOOGLE_DOCUMENT_TIMEOUT_MS` and `GOOGLE_DOCUMENT_CACHE_TTL_SECONDS`, both optional. No new secret: the feature uses `GOOGLE_API_KEY`.
- The key's Google Cloud project must have the Google Drive API enabled, and an IP restriction on the key must allow the host's IPv4 and IPv6 addresses, or video previews and document checks fail.

## [v2026.10.24-esa] - 2026-10-24

YouTube videos owned by cases, embeddable in semantic differential questions (epic #779).

Built from the external-services-architecture branch for esa staging.

### Added

- The case form adds YouTube videos by URL, with a preview of title, duration and description from the YouTube Data API v3, and orders and removes them; the copy, duplicate and publish paths carry them (#780, #781, #783, epic #779).
- The design editor's "Insertar video del caso" dialog inserts a case video into a question, under rich text contract v2, which adds `http` and `https` links and YouTube video blocks (#784, #787).
- Teacher and student views render links and embedded videos through a click-to-load facade: nothing is requested from YouTube or Google before a tap, and the player is `youtube-nocookie.com` (#785, #786).
- The case views list the case's videos as "Material complementario" (#788).

### Changed

- Only video ids are stored; metadata is fetched on demand and cached in the cache Redis with a TTL (#780).

### Deployment

- Migrations: V19 (creates `ethical_case_videos`).
- Environment contract: adds `GOOGLE_API_KEY`, `YOUTUBE_DATA_API_TIMEOUT_MS` and `YOUTUBE_METADATA_CACHE_TTL_SECONDS`, all optional. `GOOGLE_API_KEY` is a new secret: without it, case video support is off. The deploy workflow must pass it to the deploy job; the first esa staging deploy failed without it.

## [v2026.10.23-esa] - 2026-10-24

Limited rich text for phase instructions and semantic differential questions (epic #760).

Built from the external-services-architecture branch for esa staging.

### Added

- The design editor has a rich text editor, built on the ProseMirror core packages, for phase instructions and semantic differential questions, with bold, italic, lists and line breaks; pasting keeps only those (#767, epic #760).
- The texts are stored as CommonMark (`text/markdown`) with content types (`instructionsContentType`, `q_text_content_type`) carried into phases and student payloads, under the contract in `canonical-schemas/rich-text/` (#762, #763).
- Teacher and student views render instructions and questions by content type with shared `markdown-it` renderers (#764, #765, #766).

### Changed

- Existing `text/plain` instructions and questions keep their line breaks in every view, and the student view puts the instructions label on its own line (#761, #766).
- The CSV export and the Argumentation Tutor and Polyadic Agents adapters receive Markdown texts as plain text; texts without a content type are unchanged byte for byte (#768).

### Deployment

- Migrations: V18 (adds `differential.title_content_type`).
- Environment contract: unchanged.
- After a rollback to an earlier release, designs saved with the editor show their Markdown characters as plain text.

## [v2026.10.22.2-esa] - 2026-10-23

Each phase's AI services and settings in the teacher design and activity views.

Built from the external-services-architecture branch for esa staging.

### Added

- The design view lists each phase's AI services and their settings in the teacher's language, with service names translated by the adapters, such as "Agentes de discusión"; when a service does not respond, the view says so and keeps the stored settings behind "Show details" (#757, #758).
- The same summary appears in the activity view's design tab and, for the current phase, in its progress tab (#759).

### Deployment

- Migrations: none.
- Environment contract: unchanged.

## [v2026.10.22.1-esa] - 2026-10-22

Per-phase configuration of external AI services in the design editor from capability descriptors (epic #687).

Built from the external-services-architecture branch for esa staging.

### Added

- The design editor shows a settings form for each AI service enabled in a phase, built from the service's capability descriptor in the teacher's UI language, with notices for deprecated and retired settings (#727, #728, #745, #732, #733, epic #687).
- Designs store per-phase service `configurations`, validated on save with field errors (400) (#729, #731).
- What the services report when sessions are created (warnings, degraded mode) is stored on the job as `external_service_jobs.instantiation_report` (#737).
- Manifest entries declare `scopes`, localized `ui` texts and a link to their capability descriptor, and response processing follows the `response` scope (#648, #725, #726).

### Changed

- Adapters receive the phase's settings: Polyadic Agents sends them with `locale` instead of `idioma`, falling back to `AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE`, and the Argumentation Tutor sends `llm_tier` (#734, #735, #736).
- Locked designs refuse content updates with 409 (#730).
- The image's default manifest enables only Polyadic Agents and the Argumentation Tutor; `manifest.staging.json` adds Case Analyst, and `manifest.development.json` enables everything, mocks included (#738).

### Fixed

- The design editor no longer offers services disabled in the manifest (#686, #739).

### Deployment

- Migrations: V17 (adds `external_service_jobs.instantiation_report`).
- Environment contract: unchanged (descriptions of `AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE` and `EXTERNAL_SERVICES_MANIFEST` updated).
- To keep Case Analyst, set `EXTERNAL_SERVICES_MANIFEST` to `/app/backend/external-services/manifest.staging.json`, as esa staging does.
- Deploy AI Additions v2026.10.22-ai-additions first, so the descriptors arrive localized (ethicapp-ai-additions#180).

## [v2026.10.22-esa] - 2026-10-22

Cleanup and hardening of legacy ethicapp, and "back to management console" ends a teacher impersonation.

Built from the external-services-architecture branch for esa staging.

### Changed

- The "back to management console" button posts to `/api/admin/impersonation/stop`, which ends the ethicapp session and returns to `/mng/users`; NGINX serves only that endpoint of `/api/admin/` at the edge, behind the session check (#721, #724).

### Fixed

- The ranking dashboard loads for phases without chat, the ranking result templates resolve, and the teacher views no longer show untranslated keys (#718, #719).

### Removed

- Dead teacher-side frontend code, styles, images and 248 unused translation keys (#707, #717).
- The legacy admin panel remains: unused routes and helpers, the `i18n` and `ng-dialog` packages, and role `S` access to case and design reads (#714, #720).

### Security

- ethicapp serves only the public frontend asset directories, each with an allowlist of file types, and no longer `package.json`, the lockfile or raw sources; production images no longer build or serve source maps (#187, #706, #722).

### Deployment

- Migrations: none.
- Environment contract: unchanged.

## [v2026.10.21] - 2026-10-21

Security release: authorization fixes in ethicapp (#709, #710, #712, #713) and dependency updates.

### Changed

- Dependabot updates of axios, vite, proxy-addr, brace-expansion, follow-redirects, fast-uri, source-map-js and postcss-selector-parser across the packages (#645, #646, #653, #671, #679, #680, #684, #685, #688 to #696, #703).

### Security

- Role `A` (student) is no longer treated as an administrator: students read only designs, cases and case documents they own, that are public or shared, or that belong to sessions they joined, and only owners edit, archive or delete a design (#709, #716).
- A teacher impersonation lasts only while the super-admin who started it keeps arriving with role `S`; any other user on the same browser gets a new session (#710, #716).
- NGINX answers 404 for ethicapp's `/api/admin/` at the edge, so impersonation goes only through management-console and its step-up check (#712, #716).
- Locking a design requires a teacher who owns it, and a missing design answers 404 (#713, #716).
- The unprotected legacy `/phases/:id/responses` endpoints and `GET /activities/:session_id/users/:user_id/peer_responses` are removed; students answer through `POST /activities/:id/response` (#705, #716).

### Deployment

- Migrations: none.
- Environment contract: unchanged.
- management-console must reach ethicapp over `ETHICAPP_INTERNAL_BASE_URL` on the internal network (default `http://ethicapp:8501`); pointing it at the public URL breaks impersonation now that the edge blocks `/api/admin/`.

## [v2026.10.21.1-esa] - 2026-10-21

Security release: authorization fixes in ethicapp (#709, #710, #711, #712, #713).

Built from the external-services-architecture branch for esa staging. Hotfix superseding v2026.10.21-esa.

### Removed

- The remains of the legacy student UI in ethicapp: unmounted controllers, views and frontend sources, and `GET /activities/:session_id/users/:user_id/peer_responses` (#705, #708).

### Security

- Role `A` (student) is no longer treated as an administrator: students read only designs, cases and case documents they own, that are public or shared, or that belong to sessions they joined, and only owners edit, archive or delete a design (#709, #715).
- A teacher impersonation lasts only while the super-admin who started it keeps arriving with role `S`; any other user on the same browser gets a new session (#710, #715).
- `/external-services/` drops client-supplied `X-User-Id` and `X-User-Role` headers, and the unused job and result inspection routes are removed (#711, #715).
- NGINX answers 404 for ethicapp's `/api/admin/` at the edge, so impersonation goes only through management-console and its step-up check (#712, #715).
- Locking a design requires a teacher who owns it, and a missing design answers 404 (#713, #715).
- The unprotected `/phases/:id/responses` endpoints, which let any signed-in user write or read any phase's responses, are removed (#705, #708).

### Deployment

- Migrations: none.
- Environment contract: unchanged.
- management-console must reach ethicapp over `ETHICAPP_INTERNAL_BASE_URL` on the internal network (default `http://ethicapp:8501`); pointing it at the public URL breaks impersonation now that the edge blocks `/api/admin/`.

## [v2026.10.21-esa] - 2026-10-21

Vulnerable dependency fixes and upload temporary directory cleanup.

Built from the external-services-architecture branch for esa staging.

### Fixed

- Successful case uploads and uploads rejected by multer no longer leave empty temporary directories under `uploads/tmp/` (#702, #704).

### Security

- Vulnerable production dependencies are updated in ethicapp, ethicapp-student, auth-backend, management-console and external-mock-service (#697, #698, #699, #700, #701).

### Deployment

- Migrations: none.
- Environment contract: unchanged.
- Do not deploy these images: v2026.10.21.1-esa superseded them the same day with the authorization fixes, and they were never deployed.

## [v2026.10.20-esa] - 2026-10-21

Application Redis, the student session join in ethicapp-student, and clear session expiry signals for API clients (epic #625).

Built from the external-services-architecture branch for esa staging. Images rebuilt under the same tag from 94ac1a2f (auth-backend, db-migrations, ethicapp, nginx, student) and 6bdca2e2 (management-console); the git tag marks 6bdca2e2.

### Added

- Students join a session through `POST /student/api/sessions/join` in ethicapp-student, which tells apart joined, already joined, unknown code and closed joining; the teacher's live notification travels over a new Redis domain-event channel from ethicapp-student to ethicapp (#662, #663).
- A `case-created` hook dispatched to services that opt in through the new manifest field `globalHooks`, and a Case Analyst adapter skeleton that acknowledges it without calling the service (#628, #630).

### Changed

- The session Redis role is now the application Redis: `REDIS_APP_*` variables and the DNS name `redis-app`, used by the session stores of ethicapp, auth-backend and ethicapp-student, and by the domain events (#660).
- ethicapp-student keeps its sessions in the application Redis instead of memory, degrading to no stored session when Redis fails; the student session cookie lasts 24 hours instead of 8 (#661, #674).
- The NGINX edge answers API calls with `401 {"status":"expired"}` for an expired session and JSON `{"status":"unavailable"}` for upstream outages, with an `X-Request-Id` on every response; browser navigations still go to the sign-in page (#664, epic #625).
- The student app and the teacher app recognize an expired session centrally, show one notice and send the user to sign in, where the student selects the session again explicitly (#665, #666, #667, epic #625).

### Security

- The `/student` and `/teacher` Socket.IO namespaces require a signed-in session with the right role, and rooms are joined only after a server-side membership check (#659).

### Deployment

- Migrations: none.
- Environment contract: adds `REDIS_APP_HOST`, `REDIS_APP_PORT`, `REDIS_APP_URL`, `REDIS_APP_MAXMEMORY`, `REDIS_APP_MAXMEMORY_POLICY`, `ETHICAPP_STUDENT_SESSION_TTL_SECONDS` and `ETHICAPP_STUDENT_SESSION_REDIS_PREFIX`; removes `REDIS_SESSION_HOST`, `REDIS_SESSION_PORT`, `REDIS_SESSION_URL`, `REDIS_SESSION_MAXMEMORY` and `REDIS_SESSION_MAXMEMORY_POLICY`.
- There is no compatibility window: rename the `REDIS_SESSION_*` values to `REDIS_APP_*` in the same change that adopts this release, and serve the session Redis as `redis-app` (rename or network alias); no data moves.
- ethicapp-student now depends on the application Redis for sessions and domain events.

## [v2026.10.12-esa] - 2026-10-12

Health diagnostics page in management-console (epic #619).

Partial release: only the management-console image. Built from the external-services-architecture branch for esa staging.

### Added

- A diagnostics page at `/mng/diagnostics` runs DNS resolution and outbound connectivity checks (DNS, TCP, TLS) against the configured targets and shows per-stage results, error hints and certificate details (#633, #634, #635, epic #619).
- `MNG_HEALTH_CHECK_TARGETS` sets the allowlist of `label=host:port` targets the checks may reach (#632).

### Deployment

- Migrations: none.
- Environment contract: adds `MNG_HEALTH_CHECK_TARGETS` (management-console) and `AI_ADDITIONS_CASE_ANALYST_API_BASE_URL` (ethicapp). The range also contains the `globalHooks` manifest field, the `case-created` hook and the Case Analyst adapter skeleton (#628, #630), but no ethicapp image was published under this tag; they first ship in v2026.10.20-esa.

## [v2026.08.08-esa] - 2026-08-08

Report export fixes from main and external agent messages in chat transcript exports.

Built from the external-services-architecture branch for esa staging. Images rebuilt under the same tag from 983e698e (auth-backend, db-migrations, management-console, nginx, student) and b59c0a0f (ethicapp); the git tag marks b59c0a0f.

### Fixed

- Semantic differential chat transcript CSV exports include the messages of external service agents, with their author name and role and new `external_agent_id` and `external_service_id` columns (#624, epic #620).
- The dashboard chat count and CSV report fixes of v2026.08.08 are merged from main: stable group chat counts, no duplicated report rows, and a UTF-8 byte order mark on CSV exports (#609, #610, #611).

### Deployment

- Migrations: none.
- Environment contract: unchanged.

## [v2026.08.08] - 2026-08-08

Dashboard chat counts and CSV report export fixes.

### Fixed

- Group-phase chat message counts on the dashboard no longer grow on every refresh; each refresh replaces the per-user and per-group totals (#609, #621).
- Semantic differential CSV reports list each response and chat message once, instead of once per team in the phase (#610, #622).
- CSV report exports start with a UTF-8 byte order mark, so Excel shows accented characters correctly (#611, #623).

### Deployment

- Migrations: none.
- Environment contract: unchanged.

## [v2026.06.27-esa] - 2026-06-29

Callback-driven tutor feedback, phase-scoped external results and Polyadic participant identity.

Built from the external-services-architecture branch for esa staging.

- Argumentation Tutor feedback arrives only through the callback: EthicApp no longer polls the tutor's task status, and the environment contract removes `AI_ADDITIONS_ARGUMENTATION_TUTOR_POLL_INTERVAL_MS` and `AI_ADDITIONS_ARGUMENTATION_TUTOR_POLL_TIMEOUT_MS` (#599).
- Student activity tabs show external-service feedback for their own phase, the first tutor evaluation shows the submitted argument, and submission stays disabled while any response-processing service is pending (#591, #592, #593, #595, #596, #597).
- The Polyadic bridge forwards participants by their anonymous mask or first name instead of `user-<id>`, and creates rooms with a localized agent nickname (`@agente` or `@agent`) and the conversation language (#598, #600, #605).
- Group chats highlight external agent messages with a pastel yellow background and show message times in 24-hour format (#603, #604, #606).

### Image tag v2027.06.27-esa

Published by mistake under this name; it is an early build of
v2026.06.27-esa from commit a61d8894. There is no git tag for it.

## [v2026.06.25-esa] - 2026-06-26

Polyadic ConversationGuide replies published in the group chat.

Built from the external-services-architecture branch for esa staging.

- The Polyadic bridge publishes replies from the `ConversationGuide` agent as well as from `Orientador`.

## [v2026.06.23-esa] - 2026-06-23

Maintenance only: deployment manifest example update.

Built from the external-services-architecture branch for esa staging.

- The application code is the same as v2026.05.23-esa; only the deployment manifest example changes.

## [v2026.05.23-esa] - 2026-06-23

Callback eventId idempotency and activity lifecycle hooks; published on 2026-06-23 despite the May date in its name.

Built from the external-services-architecture branch for esa staging.

- Callbacks accept an optional `eventId`, and a repeated event of the same service is recognized as a duplicate (#587, #588).
- Adapters can subscribe to `activity-started` and `activity-finished` hooks, which replace `session-ended` (#589, #590).
- The ethicapp image copies the shared `ethicapp/common` directory it was missing, and each service has an `.nvmrc` pinning Node for local development.

Migrations: V16 (event id idempotency).

## [v2026.06.21-esa] - 2026-06-22

Authenticated external-service callbacks and database-backed job tracking (epic #572).

Built from the external-services-architecture branch for esa staging.

- AI services deliver results to one callback endpoint, `POST /external-services/callbacks`, authenticated with a Keycloak bearer token (`EXTERNAL_SERVICES_CALLBACK_AUTH_*`); the per-service unauthenticated results endpoints are removed (#571, #573).
- External-service jobs and callback results are stored in PostgreSQL: dispatch records correlation metadata, a callback must match a dispatched job of its service, and the Polyadic and tutor adapters propagate the `correlationId` (#574, #575, #576, #577, #578, epic #572).
- Teachers can inspect jobs and results through `GET /external-services/jobs`, `/external-services/jobs/:job_id` and `/external-services/results`, which leave out raw provider payloads (#579, #586).
- The external services routes are mounted before the legacy auth middleware.

Migrations: V15 (`external_service_jobs`).

## [v2026.06.19-esa] - 2026-06-20

Shared AI Additions client and the Polyadic Agents bridge adapter.

Built from the external-services-architecture branch for esa staging.

- External-service adapters authenticate through a shared AI Additions client (Keycloak client credentials, token cache, one retry after 401); the environment contract replaces the `ATS_*` variables with `AI_ADDITIONS_*` ones (#568).
- The `polyadic-devils-advocate` bridge creates and closes Polyadic Agents rooms per group, forwards group chat over REST and publishes the guide agent's replies in the group chat, configured with `AI_ADDITIONS_POLYADIC_AGENTS_*`; hook names are kebab-case (#570).
- Argumentation Tutor feedback shows localized language labels, and the claim score appears as a label without its -1, 0 or 1 value.
- The branch includes main's v2026.06.11 (manual design validation and the student group chat fix).

## [v2026.06.11] - 2026-06-11

Manual design validation for teachers and a student group chat fix.

Images rebuilt under the same tag from ab9e0ed1 (ethicapp) and 8af18303 (auth-backend, db-migrations, management-console, nginx, student); the git tag marks ab9e0ed1.

- The design editor has an "Ejecutar validaciones" button that validates the whole design, and saving a design recalculates its validity first (#567).
- The student chat button appears only in phases with chat enabled and a valid group; earlier chat phases reopen read-only, and messages are sent with the correct group.

## [v2026.06.04] - 2026-06-04

reCAPTCHA Enterprise support.

- auth-backend verifies reCAPTCHA Enterprise tokens and the auth and management frontends load the matching widget, chosen with `RECAPTCHA_PROVIDER` (`classic` by default) and configured with `RECAPTCHA_ENTERPRISE_PROJECT_ID` and `RECAPTCHA_ENTERPRISE_API_KEY` (#560, #561, #562, #563, #564, #565, #566).

## [v2026.06.04-esa] - 2026-06-04

The external-services-architecture branch updated with main through v2026.06.04.

Built from the external-services-architecture branch for esa staging.

- Compared with v2026.06.03-eas, the branch brings in main's unauthenticated SMTP relay support and reCAPTCHA Enterprise support (#560, #561, #562, #563, #564, #565, #566).
- The environment contract documents the canonical activity seed variables, and the branch's deployment manifest example is updated.

## [v2026.06.03] - 2026-06-04

Unauthenticated SMTP relay support and canonical activity seed variables.

- auth-backend sends mail without `SMTP_USER` and `SMTP_PASS` when the SMTP server accepts unauthenticated relay, and rejects a configuration with only one of them.
- The environment contract documents `ETHICAPP_SEED_CANONICAL_ACTIVITIES` and `ETHICAPP_SEED_CANONICAL_ACTIVITIES_ATTEMPTS`.

## v2026.06.03-eas - 2026-06-03

First build of the external-services-architecture branch, published with a misspelled suffix (`-eas` instead of `-esa`); no git tag exists for it.

Built from the external-services-architecture branch for esa staging.

- Over main at v2026.06.02, the EthicApp backend has an external services layer: a manifest of services, a registry of adapters subscribed to phase transition, student response and group chat hooks, and a callback endpoint for results.
- An Argumentation Tutor adapter (`ats-feedback.adapter.js`, configured with `ATS_*` variables) and mock adapters publish results to students; the student app renders external service results, and external agents appear as their own chat authors.
- An `external-mock-service` supports demos of the integration, with deployment documentation for it and for the tutor variables.

Migrations: V14 (`external_service_agents` table and `external_agent_id` on the chat tables).

## [v2026.06.02] - 2026-06-02

Session security, management passkeys, student anonymization, maintenance mode and production backups.

- Sessions have role-aware idle and absolute timeouts, a session version that revokes older sessions, sliding renewal through the nginx `auth_request`, and a management console cookie lifetime; the environment contract adds the `AUTH_SESSION_*_TIMEOUT_MS` variables, `AUTH_SESSION_TOUCH_INTERVAL_MS` and `MNG_SESSION_COOKIE_MAX_AGE_MS` (#532, #533, #537, #538, #539, #540, #541).
- Administrators can register passkeys and confirm sensitive user operations with WebAuthn; the environment contract adds the `WEBAUTHN_*` variables (#531).
- A management-console job anonymizes student accounts and their free-text content and records an audit trail (`MNG_PROCESS_ROLE=student-anonymization`, `STUDENT_ANONYMIZATION_*`), and nginx can serve a maintenance page (`NGINX_MAINTENANCE_MODE`, `NGINX_MAINTENANCE_RETRY_AFTER`) (#546, #547, #548, #549, #550, #551, #554, #555).
- A production backup kit backs up and restores PostgreSQL and protected uploads (`BACKUP_*`, `RESTORE_UPLOADS`, `RESTORE_UPLOADS_REPLACE`), and the production nginx upstream ports are templated (#518, #556, #559).
- The management console has profile and institution settings, and auth reads the institution metadata from it instead of `VITE_INSTITUTION_NAME` and `VITE_DATAPRIVACY_CONTACT`; teachers can set a preferred language, and the case form gives clearer validation feedback (#514, #557).

Migrations: V9 (institution profile), V10 (user passkeys), V11 (user session version), V12 (student anonymization audit) and V13 (institution data privacy contact).

## [v2026.05.25] - 2026-05-25

Hold-to-confirm activity controls and the case document in the activity dashboard.

Partial release: only the `ethicapp` image.

- Teacher activity controls use a hold-to-confirm gesture.
- The activity dashboard shows the associated case document.

## [v2026.05.24] - 2026-05-24

Tag taxonomy seeds packaged in the EthicApp image, and teacher layout adjustments.

Images rebuilt under the same tag from 5f120f31 (ethicapp) and 96aecdc5 (auth-backend, db-migrations, management-console, nginx, student); the git tag marks 5f120f31.

- The EthicApp image packages the tag taxonomy seeds; the environment contract adds `ETHICAPP_SEED_TAG_TAXONOMIES`, `ETHICAPP_SEED_TAG_TAXONOMIES_ATTEMPTS` and `ETHICAPP_TAG_TAXONOMY_SEED_DIR`, and documents the canonical uploads path.
- The case view has a zoom overlay, and the profile page layout and profile picture update are improved.
- Teacher mobile resource layouts, the order of the home cards and the language picker are adjusted.

## [v2026.05.23] - 2026-05-24

Sharing policy for cases and designs, semantic tags, and Flyway database migrations.

Images rebuilt under the same tag from cba4a4e5 (ethicapp, management-console, nginx, student), 62c73245 (auth-backend) and 02edbd5e (db-migrations); the git tag marks 62c73245.

- Cases and designs carry sharing metadata (visibility, license, attribution, authorship, lineage, language, archived state), with archive, duplicate and publication flows, and items linked to launched activities are locked (#528).
- Teachers can select semantic tags for cases and designs (#530).
- The database schema is managed by Flyway: the legacy migrations are consolidated, unused legacy tables are dropped, and a `db-migrations` image replaces the `database` image (#530).
- auth-backend has an account confirmation workflow with idempotent confirmation links, seeded admin accounts are confirmed, and the registration success notice waits 10 seconds before redirecting to login.
- Templates and the teacher home cards fit mobile screens better.

Migrations: V1 to V8 (consolidated baseline: base active schema, designs and activities, ethical cases, report exports, PDF render jobs, sharing rights, languages and authors, semantic tag taxonomies, token purposes).

## [v2026.05.18] - 2026-05-19

Protected upload access and rendered case documents.

Images rebuilt under the same tag from 0b718641 (ethicapp) and 5cb5089e (auth-backend, database, management-console, nginx, student); the git tag marks 0b718641.

- Uploaded files are served by an access-controlled controller: case PDFs only to users related to the case, its designs or its activities, avatars only to authenticated users, and unauthenticated requests go to login (#519, #525, #527).
- A PDF render worker turns case PDFs into images through a job queue, and the teacher and student apps show the rendered documents and their processing status; canonical cases are seeded with rendered assets. The environment contract adds `ETHICAPP_PROCESS_ROLE` and `PDF_RENDER_DPI`, `PDF_RENDER_MAX_PAGES`, `PDF_RENDER_TIMEOUT_MS`, `PDF_RENDER_WORKER_CONCURRENCY` and `PDF_RENDER_WORKER_POLL_INTERVAL_MS` (#526, #527).
- The teacher home action cards are refined, and several views have a consistent back button.

## [v2026.05.17] - 2026-05-17

Audited activity CSV report exports and a lighter legacy teacher frontend.

Images rebuilt under the same tag from 4f3e066f (ethicapp) and 4c28e700 (auth-backend, database, management-console, nginx, student); the git tag marks 4f3e066f.

- Teachers can download semantic differential responses and chat transcripts as CSV after a consent notice; each export is logged in `activity_report_exports` with row count, size and SHA-256 hash (#523).
- The legacy teacher frontend drops its `libs` directory and trims its bundle, and gains a bootstrap screen and a lightweight toast component.
- Legacy EthicApp mobile and locale behavior is normalized, auth redirects keep their query strings, and design views link their associated cases.

## [v2026.05.15] - 2026-05-16

CSRF protection for auth and management, and shared designs with their cases.

Images rebuilt under the same tag from e4d1562b (ethicapp) and 4ce47a4d (auth-backend, database, management-console, nginx, student); the git tag marks e4d1562b.

- auth-backend and management-console require a session-bound CSRF token on mutating requests; management-console calls auth-backend with an internal service token. The environment contract adds `AUTH_INTERNAL_SERVICE_TOKEN`, which must have the same value in both services, and `AUTH_SESSION_SECRET` for auth-backend (#520).
- The legacy logout uses a CSRF-protected POST (#521, #522).
- Teachers can import shared designs together with their cases, see the creators of shared designs, and open cases from activities and case cards.
- Teacher catalog refresh and search fields, design selection and the auth password visibility toggle are fixed or polished.

## [v2026.05.14] - 2026-05-14

Shared brand assets served by nginx and a preserved registration draft.

- nginx serves the shared logo, favicon and Nunito font assets, and the teacher layout uses Nunito.
- The registration form keeps its draft while the user reads the legal pages.

## [v2026.05.13] - 2026-05-13

Production fixes for environment-neutral images, nginx proxying and Redis roles.

Images rebuilt under the same tag from 84c04e37 (ethicapp, management-console), 1bfee01e (auth-backend, database, student) and 7476321c (nginx); the git tag marks 84c04e37.

- The auth, student and management console frontends read their public `VITE_*` values from a `runtime-config.js` generated at container start, so the published images no longer depend on the environment they were built for.
- The production nginx facade resolves its upstreams through Docker DNS at request time, keeps an `X-Forwarded-Proto` set by an outer TLS proxy, and issues path-only redirects.
- Production resolves Redis only through `REDIS_SESSION_*` and `REDIS_CACHE_*`; the environment contract removes `REDIS_HOST`, `REDIS_PORT` and `REDIS_URL`, and `SMTP_PORT` and `SMTP_SECURE` assume a secure connection.
- Production bundles keep AngularJS injection names (legacy JavaScript built without minification) and serve Bootstrap CSS from the public assets; professor impersonation works behind HTTPS, and legacy sessions follow a role changed in auth-backend.
- The EthicApp backend no longer reads the build-excluded `config/config.js`, and the repository keeps a single local-development `docker-compose.yml`.

## [v2026.05.12] - 2026-05-12

Removal of the legacy EthicApp auth surface and a deployment contract under `deploy/`.

Partial release: only the `ethicapp` and `nginx` images.

- The legacy EthicApp service drops its Passport local and Google OAuth login, its registration and password reset views, and its Gmail and AWS SES mail sender; legacy auth redirects point at `/auth/login`. The environment contract removes `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_USER_ENCRYPTED`, `GMAIL_PASS_ENCRYPTED`, `CREDENTIALS_IV`, `CREDENTIALS_SECRET_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `FROM_EMAIL` and `DOMAIN_NAME`.
- The deployment contract moves from `config/` to `deploy/env.contract.yml`, next to a deployment manifest example that pins releases by image tag, and production nginx routing is aligned with the documented deployment conventions.

## [v2026.05.11] - 2026-05-11

Earliest published image set of ethicapp-main in the registry, built from 32b29471 (`ethicapp`, `auth-backend`, `student`, `management-console`, `nginx` and `database` images).

- A GitHub workflow publishes the service images to GHCR, and a canonical environment contract (`config/env.contract.yml`) describes the deployment variables.
- Production Compose runs separate Redis instances for sessions and for cache, configured with `REDIS_SESSION_*` and `REDIS_CACHE_*` and falling back to `REDIS_*`.

[v2026.11.07]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.11.07
[v2026.11.05]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.11.05
[v2026.11.04.1]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.11.04.1
[v2026.11.04]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.11.04
[v2026.11.03]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.11.03
[v2026.11.02.1]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.11.02.1
[v2026.11.02]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.11.02
[v2026.10.28]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.28
[v2026.10.27]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.27
[v2026.10.26]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.26
[v2026.10.25]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.25
[v2026.10.24.1-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.24.1-esa
[v2026.10.24-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.24-esa
[v2026.10.23-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.23-esa
[v2026.10.22.2-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.22.2-esa
[v2026.10.22.1-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.22.1-esa
[v2026.10.22-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.22-esa
[v2026.10.21]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.21
[v2026.10.21.1-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.21.1-esa
[v2026.10.21-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.21-esa
[v2026.10.20-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.20-esa
[v2026.10.12-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.10.12-esa
[v2026.08.08-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.08.08-esa
[v2026.08.08]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.08.08
[v2026.06.27-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.06.27-esa
[v2026.06.25-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.06.25-esa
[v2026.06.23-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.06.23-esa
[v2026.05.23-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.05.23-esa
[v2026.06.21-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.06.21-esa
[v2026.06.19-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.06.19-esa
[v2026.06.11]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.06.11
[v2026.06.04]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.06.04
[v2026.06.04-esa]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.06.04-esa
[v2026.06.03]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.06.03
[v2026.06.02]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.06.02
[v2026.05.25]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.05.25
[v2026.05.24]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.05.24
[v2026.05.23]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.05.23
[v2026.05.18]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.05.18
[v2026.05.17]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.05.17
[v2026.05.15]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.05.15
[v2026.05.14]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.05.14
[v2026.05.13]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.05.13
[v2026.05.12]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.05.12
[v2026.05.11]: https://github.com/EthicApp-Development/ethicapp-main/releases/tag/v2026.05.11
