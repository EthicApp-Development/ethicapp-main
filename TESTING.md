# Testing Policy

EthicApp uses a layered testing strategy. The goal is to keep image builds protected by fast deterministic checks while leaving room for broader regression coverage against real infrastructure during development and CI.

## 1. Testing Layers

### 1.1. Lightweight Guardrail Tests

Lightweight guardrail tests are the current automated baseline.

Purpose:

- Catch regressions quickly while building service images.
- Exercise backend route, middleware, helper, and service behavior with controlled dependencies.
- Keep tests deterministic and safe to run on developer hosts and inside Dockerfile build stages.

Conventions:

- Use the built-in Node.js test runner.
- Name test files with `*.node-test.mjs`.
- Keep tests beside the code they exercise, following each service's existing test layout.
- Use mocks, fakes, injected services, in-memory Express apps, and temporary local files where appropriate.
- Do not require PostgreSQL, Redis, SMTP, external HTTP APIs, or local-only configuration.

Examples of appropriate guardrail assertions:

- A route rejects invalid input before calling a database dependency.
- A controller maps a duplicate-account condition to a stable response code.
- A helper generates the expected SQL shape or query parameters.
- A transaction path calls `BEGIN`, mutation queries, and `COMMIT`/`ROLLBACK` in the expected order.
- Middleware accepts or rejects requests based on session/header state.

These tests are intentionally not a substitute for database integration coverage.

Canonical schemas (`canonical-schemas/`) have their own guardrail tests at the repository root: `npm run test:schemas` validates example and seed documents against the JSON Schemas with `@cfworker/json-schema`, including the examples of the `student-result/v1` schema copied from ethicapp-ai-additions (`canonical-schemas/ai-additions/`). They run on the host, outside image builds. The `ethicapp` image ships only `canonical-schemas/ai-additions/`, which the backend reads at runtime to validate the documents published to students (#1131), and its backend tests validate those examples too.

### 1.2. Integration Regression Tests

Integration regression tests are a planned second layer for development and CI.

Purpose:

- Validate behavior against real PostgreSQL schema, constraints, indexes, transactions, migrations, and seed assumptions.
- Catch SQL drift that mocks cannot detect.
- Exercise cross-service behavior where real HTTP/session/proxy/cookie flows matter.

Preferred conventions:

- Use a separate command such as `npm run test:integration` in the relevant service.
- Name integrated suites distinctly, for example `*.integration-test.mjs`.
- Run against an ephemeral PostgreSQL database managed by a dedicated Compose test file or a test-container style harness.
- Keep test data isolated through transactions, truncation, schema reset, or disposable databases.
- Keep these tests out of Dockerfile image construction.

Integration tests should be explicit about their infrastructure requirements and should fail with clear setup errors when the required test database is unavailable.

The `test:integration` scripts run their files one at a time (`--test-concurrency=1`). All files share one database, and some assert on global state, such as the current AI service policy version, which a file running in parallel would change.

Current integration suites (one disposable database with migrations V1 to V45 applied serves all three):

- `ethicapp/backend`: `npm run test:integration` runs `**/*.integration-test.mjs` against the database in `ETHICAPP_INTEGRATION_DATABASE_URL`, which must have migrations V1 to V45 or later applied (the fixtures insert accounts without a RUT, one suite checks that V43 dropped `users.rut`, and another checks the phase clock columns that V45 adds). When the variable is unset, the suites are skipped with a message saying so. They insert rows that are not cleaned up (AI service policy versions are append-only), so point them at a disposable database. For example:

  ```bash
  docker network create ethicapp-it
  docker run -d --name ethicapp-it-pg --network ethicapp-it \
    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ethicapp -p 127.0.0.1::5432 postgres:16
  docker run --rm --network ethicapp-it \
    -e FLYWAY_URL=jdbc:postgresql://ethicapp-it-pg:5432/ethicapp \
    -e FLYWAY_USER=postgres -e FLYWAY_PASSWORD=postgres -e FLYWAY_CONNECT_RETRIES=30 \
    -e FLYWAY_LOCATIONS=filesystem:/flyway/migrations \
    -v "$PWD/database/migrations:/flyway/migrations:ro" \
    flyway/flyway:11-alpine migrate
  cd ethicapp/backend
  ETHICAPP_INTEGRATION_DATABASE_URL="postgres://postgres:postgres@$(docker port ethicapp-it-pg 5432)/ethicapp" \
    npm run test:integration
  docker rm -f -v ethicapp-it-pg && docker network rm ethicapp-it
  ```

  The first suite covers the activity launch transaction and the AI service policy pin, including two concurrent launches of the same session. Others cover pending callback results and their concurrent claim (V23), and room-scoped jobs (V24): opening, supersession, closing, and the refusal of a callback to a closed room job; and design analyses (V25): reservation, in-flight and stale generations, conditional completion and failure, replacement of the previous document, deletion with the design, reservation on save (unchanged input hash, supersession of a generation in flight), and the copy of ready analyses to a duplicated design; and the adapters a policy version switches off (V26): the empty default for existing and new versions, the stored list as the policy store reads it, the rejection of NULL ids, and the append-only rule; and the student activity descriptor of an activity in progress and of a finished one, which has no current phase; and the selection and finishing of a teacher's open activities (initiated, in progress, or without a status), which a second call finds nothing left of, and the pending finalization (V30) that a failure after the update leaves, which the retry and the teacher's route resume with the phase it recorded, and the end time (V41) that the first finish records and a repeated or resumed finish keeps, while a session finished before V41 keeps none; and the account creation time (V28): the column default dates new accounts, and replaying the migration leaves existing accounts without a date instead of backfilling them; and the user erasure requests (V31, #876): the processor's retries with a growing backoff until the service confirms, the lease that makes a request cut short by a crash or a restart due again, concurrent claims that never take the same request, and a refusal that stays failed until an administrator's retry; and the deletion of upload files (V32, #877), against a temporary uploads root: a case directory and profile images deleted, the folder they leave empty removed, a path kept as `skipped` while a case or another case's PDF path still references it, a failure retried with backoff and run at once by an administrator's retry, a directory a render may still be writing that neither an administrator's retry nor a due backoff deletes before its `not_before`, a deletion cut short by a crash that is due again once its lease ends, and another teacher's copy that still loads the PDF of a forgotten teacher's case; and the statements with which a teacher creates a session and moves it to a phase, which, requested after a teacher's forgetting locked the account and made its last count, wait and write nothing once it commits, while a transition committed before the lock is counted, and which only the session's teacher with an account not anonymized can run; and the PDF render job statements: a job flagged while a worker renders it (an author email erased) is queued again on completion, also when the flag is committed while the completion waits for the row, and its next claim clears the flag; and starting an activity's next phase (V33, #906): the phase, its items and, for a team phase, its groups created from the stored design in one transaction, with random and preserved groups lettered A, B, C... per group; nothing left, and the session unmoved, by a failure after the items and groups; two concurrent starts of the same phase, of which one starts it and the other is told the activity moved on; the `UNIQUE (sesid, number)` constraint; a phase left by a start that failed before this transaction, replaced; the refusal of other teachers, anonymized accounts and finished activities; and a start that waits for the forgetting of its teacher, or for the finishing of its activity, and then writes nothing; and each phase's clock (V45, #1110): its start, equal to the database's now() in the start's transaction, its trigger, and, in a soft or hard activity, its duration and a deadline that many seconds later, with no deadline in an activity without a time mode or for a phase without a duration; the deadline of the phase a teacher's start leaves, marked handled; a start by the deadline that advances a hard-mode phase whose deadline passed, and that writes nothing and answers `not_due` before the deadline, in soft mode, once the deadline is handled and before the first phase; the last phase's deadline, handled without finishing the activity; the teacher and the deadline, or two deadline starts, starting the same phase at once, of which one starts it and the other is told the activity moved on; and an extension committed while a start by the deadline waits for the phase, which the start sees. Another covers the students' pseudonym numbers on the teacher's dashboard (V34, #897): the table's keys, check and cascading foreign keys; one unique number in 1-99 per student and none for the teacher; a late joiner who gets a new number while nobody else's changes; a class of 51 drawn from 1-999; eight concurrent requests, and two that draw the same numbers and retry their collisions, all ending with the same unique numbers; the rows deleted with their session or account; and the ownership check of a phase (`PHASE_OWNERSHIP_SQL`). Another covers the usage counts of a case in `GET /cases` (#1011): zeros for a case no design uses, the teacher's own designs and other teachers' designs and teachers, archived designs included, and the activities launched from any of them; and the uses of a case in `GET /cases/:id/uses` (#1012): the activities of the teacher's own designs only, and the teacher's own designs that use the case, by id and title, archived ones last, with no other teacher's design. Another covers the case analyses of a copy of a case (#1038): the ready analyses copied with their document, schema and times, a reviewed one without its review and a failed latest generation with its error, none of the analyses in flight, failed without a document or never started, and the rows the copy already has kept; the services the copy did not inherit reserved for the copying teacher, without those the policy no longer allows; and a new generation of an inherited analysis that changes the copy and leaves the source as it was. It also covers the services added to an existing case (#1039): only those the case lacks are reserved, a service already chosen is left as it was, and three concurrent requests for a service reserve and dispatch it once. And the removal of an analysis (#1040): a late `complete`, `fail` or `markProcessing` of a generation in flight or not started stores nothing and creates no row, the case's other analyses are kept, the service added again starts afresh while the old job still stores nothing, and a copy of the case keeps its own analysis. Another covers the accounts' emails (V42, #1068) and the RUT's removal (V43, #1072): `users` without the `rut` column and `idx_users_rut`, two emails that differ only in letter case refused on insert and on update by `users_mail_lower_unique` (23505), the index in place of the case-sensitive `users_mail_unique`, a replay of V42 that stops, listing the colliding accounts, when two emails differ only in letter case, and a replay of V43 that drops the column, its values and its index. Another covers the copy of a case, which the case import, the case duplicate and the design import make with the same helpers: the copy's row (#1085), inserted with one statement, with the source's license and rights details (rights status, license notes, permission statement, commercial source) kept, its provenance and attribution recorded, and the default license for a source without one; and the copy's authors, tags, videos and documents (#1089), copied by one function inside the caller's transaction, with an author linked to the account whose email matches whatever the letter case, the tags assigned by the copying teacher, and the videos and documents in their order. Another covers the route through which a student reads the external-service results published to them (#1127), with a stub `student-results-reading` handler: the student's own results of the session's phases, oldest first, without another student's, another session's or pending ones; the results of a phase outside the session left out; an empty list for an activity whose design enables no service and for services that published nothing; and another student's id, a session the student is not enrolled in, an unknown session, an anonymized student and the teacher's role, each refused with the status and body `full_state` answers. Another covers the chat messages of a student's `full_state` (#1122), for a semantic differential and a ranking activity whose two phases each have two groups that both wrote messages: none of the other group's messages and none of its members' ids, on a first call and on a second one served from the cache, which the suite keeps in memory in place of Redis; no `groupMessages` in any phase; and the group chat route, which still returns the student's own group's messages and refuses the other group's. Another covers the author names of external agents' chat messages (#1026), in the group chat transcripts of both design types and in the semantic differential report: the per-room name a completed callback result records for each published message, the raw payload's name while the result is still being handled (cut to 80 characters), and the agent row's name for a result completed before #1026, a result of an anonymized student (redacted by V31 on insert and on update), and a message published outside a callback. Another covers the phase clock (V45, #1106): `sessions.time_mode`, a non-null text that defaults to `'none'`, and the clock columns of `stages` (`started_at`, `duration_seconds`, `ends_at`, `start_trigger`, `deadline_handled_at`), nullable and without a default; the checks that accept only `'none'`, `'soft'` and `'hard'` as a time mode, a positive duration and `'teacher'` or `'deadline'` as a start trigger; the partial index `idx_stages_pending_deadline` on `ends_at` of the deadlines that are set and not yet handled, which a lookup of due deadlines can use; and a replay of V45 that gives existing activities `'none'` and leaves their phases without a clock. Its tests roll back what they insert. Another covers the phase clock that the dashboard and the student app read (#1111): an activity followed from launch to finish, with no phase before the first start, a five-minute deadline, a phase without a duration and no deadline, the last phase of the design, and a finished activity without a current phase; no deadline in an activity without a time mode; the last phase of a design without phases, and an unknown session; the server's time from `clock_timestamp()`, later than the `now()` of the transaction that reads it; and the clock that a phase start announces after its commit, the same for the students and the teacher. Another covers the grace window after an automatic advance (#1114): through `POST /activities/:id/response`, on hard-mode activities whose phases the real phase starter starts by the teacher or by the deadline, an answer to the previous phase within 15 s of a deadline advance stored against that phase (semantic differential and ranking), replaced when sent again, and set off with the teacher's notification but no AI service hook; the same answer refused with `PHASE_CHANGED`, with nothing written, from 15 s on, after a teacher's advance, for an older phase and for another session's phase; a late answer refused like a current one for a student of another session, a question of another phase and a value out of range, and with `ACTIVITY_FINISHED` once the activity is finished; and a team phase's view of its group's earlier answers, which shows a late answer and is not cached inside the window but is after it, with Redis replaced by an in-memory map.

- `management-console/backend`: `npm run test:integration` runs `**/*.integration-test.mjs` against the same kind of database, with migrations V1 to V44 or later applied (its fixtures insert accounts without a RUT, and the code it tests no longer names `users.rut`, which V43 drops; V44 keeps agent names in redacted payloads), and reads the same `ETHICAPP_INTEGRATION_DATABASE_URL`, so one disposable database serves both suites. Run it from `management-console/backend` in place of `ethicapp/backend` in the example above. It covers the confirmation of a pending account and the administrator audit log (V27): the account activated and its confirmation tokens deleted, the refusal of active, deactivated and anonymized accounts, two concurrent confirmations of the same account, the append-only rule of `admin_audit_events`, and the checks that keep free text out of it. It also covers the deletion of a never-activated account (#875): the account deleted with its tokens and passkeys and its email free to sign up again, the refusal of accounts that were ever active, signed in or anonymized, or that a table references (with and without a foreign key), a reference inserted while the deletion waits for the account row, and two concurrent deletions. A schema check compares the list of columns that hold a user id (`services/user-references.js`) with the foreign keys to `users` in `pg_constraint`, with their `ON DELETE` rules, and with the user-like integer columns that have no foreign key, so a migration that adds a reference to `users` fails it until the reference is listed. It also covers forgetting a student (V31, #876): the transaction (account, written responses, AI service payloads, the run, the pending erasure requests and the audit row), the refusal of teachers, administrators and anonymized accounts, two concurrent forgettings, the same coverage from the scheduled job's per-account step, the checks of `user_erasure_requests`, the refusal to edit an anonymized account, an edit that read the account before it was forgotten and wrote it after, callbacks stored after the forgetting or while it runs (their payloads keep no text), a forgetting that waits for callbacks in progress, and, with `EXPLAIN` and sequential scans switched off, that the anonymization statements use the V31 user indexes. It also covers forgetting a teacher (V32, #877): the transaction (private, unused and uncopied cases and designs deleted with their dependent rows, the rest kept, the author emails erased in the teacher's materials and in other teachers' copies while the author names stay, the manifests queued for rendering again, the chat placeholder, the run of role `P`, the erasure requests, the file deletions and the audit row with its target role), the transfer to a recipient, the refusals (students, anonymized accounts, a changed email, unavailable or changed recipients) that finish no activity, an activity opened or a finalization pending while the teacher is being forgotten (`OPEN_ACTIVITIES`), ethicapp failing to finish the activities, two concurrent forgettings of the same teacher, two teachers forgotten at once as each other's recipient, an edit that read the teacher before the forgetting, renders in flight when the teacher is forgotten (the kept case's job flagged to run again, the deleted case's directory waiting in `not_before`), the preview, the checks of `upload_deletion_requests`, and, with `EXPLAIN`, the V32 indexes. Forgetting needs V31 and V32, and the schema check compares the list with every migration up to V34 (`activity_participant_pseudonyms.user_id`, #897), so run it against V1 to V43 or later. Another covers the redaction of AI service payloads (V44, #1155): the database's `redact_jsonb_strings` and the console's `redactJsonStrings` give the same JSON for Polyadic and tutor payloads and for edge cases, and a forgotten student's Polyadic result keeps its `agente` and `agentName` values while every other string, the per-room `display_name` included, becomes the placeholder, on insert and on update. The accounts, sessions, runs, audit events and results it inserts are not removed.

- `auth-backend`: `npm run test:integration` runs `**/*.integration-test.mjs` against the same kind of database, with migrations V1 to V43 or later applied (its fixtures insert accounts without a RUT, and the code it tests no longer names `users.rut`, which V43 drops), and reads the same `ETHICAPP_INTEGRATION_DATABASE_URL`. Run it from `auth-backend` in place of `ethicapp/backend` in the example above. It covers an administrator setting a user's password (#889): the new hash, the cleared legacy `pass` column, the incremented `session_version`, the deleted password-reset tokens (other tokens and other users' tokens kept), activation left unchanged, the refusal of administrator and anonymized accounts and of a changed email without any change, and two concurrent settings. It also covers password recovery's write (`services/password-reset.service.js`) and its order with the administrator's: the stored password, a pending sign-up confirmed and the tokens consumed; a recovery that checked its link before an administrator set the password, refused with the administrator's password kept; a recovery waiting for the account while an administrator's change commits, refused; a recovery that completes first, replaced by the administrator's password; and two recoveries with the same link, only one of which stores its password. It covers an administrator creating an account (#1170): the stored row (active, confirmed, local, the locale, a hash of the password, no tokens) and the refusal of an email already registered in another letter case. The accounts and tokens it inserts are not removed.

### 1.3. End-to-End and Smoke Tests

End-to-end and smoke tests are appropriate for validating the full Compose stack or release candidates.

Purpose:

- Validate NGINX routing, service boundaries, runtime configuration, cookies, sessions, and key user flows.
- Confirm that frontend and backend services cooperate correctly after images are built.

These tests should be a separate CI/release step, not part of service Dockerfile builds.

`npm run test:nginx-edge` (`scripts/test-nginx-edge.sh`) is a first check of this kind. It builds the `nginx` image, runs it with both the production template and `dev.conf` against stub upstreams on a private Docker network, and verifies how the edge answers missing sessions, outages, request ids, internal-only routes, and the shared assets of `nginx/static` (logo, favicons, font) at the root and under each SPA prefix (#999). It needs Docker but none of the application services.

`npm run test:nginx-config` is the static counterpart for internal-only routes. It parses both configurations without Docker and checks that the location NGINX selects for each internal `/api/admin/` route is the blocking `location ^~ /api/admin/`, and likewise for auth-backend's internal `/api/auth/admin/users` routes (#889, #1170), with and without a trailing slash. It also checks the Vite plugin that serves `nginx/static` under `vite` and `vite preview` (#999, `<spa>/vite/nginx-static-assets.js`): the three SPAs' copies are identical, both configurations serve every file of `nginx/static/{fonts,favicon,logos}` from the same place as the plugin, at the root and under each SPA prefix, and the plugin refuses paths that leave those directories. The parsing and location selection both suites use live in `nginx/__tests__/nginx-locations.mjs`.

## 2. Docker Image Build Policy

Some service Dockerfiles include a `backend-test` stage that runs lightweight backend tests before building the final runtime image.

Current image build guardrails:

- `docker compose build ethicapp` runs `npm test` in `ethicapp/backend`.
- `docker compose build auth-backend` runs `npm test` in `auth-backend`.
- `docker compose build management-console` runs `npm test` in `management-console/backend`.

Tests executed during Docker image builds must:

- be fast enough for routine local builds,
- be deterministic,
- avoid external services,
- avoid depending on developer-local files or secrets,
- use mocks/fakes for database and network dependencies,
- leave no persistent host or container state behind.

Do not start PostgreSQL, Redis, SMTP, browser automation, or multi-service orchestration inside a Dockerfile build stage.

## 3. Reuse Between Layers

Do not try to make the same test suite run unchanged in both guardrail and integration modes. The layers answer different questions:

- Guardrail tests ask whether application logic makes the right decisions when dependencies return controlled responses.
- Integration tests ask whether the application really works with the database schema, constraints, transactions, and service boundaries.

Prefer sharing neutral helpers instead of sharing whole test cases:

- payload factories,
- user/test-data factories,
- request helpers,
- response assertion helpers,
- password/locale constants,
- Express app factories,
- database seed/reset helpers for integration tests.

Avoid building a generic test abstraction that hides whether a test is using a mock database or a real database. Tests should be honest and readable about the layer they belong to.

## 4. Current Coverage Status

Automated coverage is currently strongest in the lightweight guardrail layer.

Current guardrail coverage includes:

- `ethicapp/backend`: upload middleware behavior, protected upload authorization, rendered case-document access contracts, PDF render job status helpers, and selected session middleware behavior.
- `auth-backend`: CSRF protection plus authentication route behavior for login, registration validation, duplicate account handling, locale normalization, forgot-password token creation, and password reset.
- `management-console/backend`: CSRF protection and professor impersonation route behavior, including reCAPTCHA rejection, role rejection, and EthicApp session cookie forwarding; the confirmation of a pending account (route, step-up, transaction order, refusals), the deletion of a never-activated account (route, step-up, transaction order, refusals, the list of user references), the administrator audit helper, forgetting a student (route, step-up, transaction order, refusals, the AI service payload erasure and the erasure requests of the per-account step) and the client of ethicapp's erasure status and retry.
- `ethicapp/backend` (#876): the `user-forgotten` handlers of the tutor and Polyadic adapters, the erasure hooks' policy bypass, the erasure request processor (backoff, error classification, scheduling) and its internal endpoints.
- Forgetting a teacher (#877): in `management-console/backend`, the service with a fake database (statement order, the activities finished before the transaction, refusals before and inside it, `OPEN_ACTIVITIES`, the transfer, the delay of a case directory still being rendered, the preview), the routes (`expected_role`, recipient validation, status codes, the preview), the generalized per-account step (teacher identity, passkeys, profile image deletions), the upload deletion helper, the audit row's target role, the forgetting treatment of every user reference, and the client's file deletion summary; in `ethicapp/backend`, the upload deletion processor on a temporary uploads root (deletion, references kept, invalid paths, symbolic links out of the root, file system errors and backoff), the status and retry endpoints with file deletions, and the attribution of a forgotten teacher's designs; in `management-console/frontend`, the teacher's dialog (plan, recipient, step-up details, refusals, unsaved edits, both locales) and the file status in the erasure panel.
- Starting an activity's next phase (#906): in `ethicapp/backend`, the endpoint (the owner check, the request, which carries only the expected phase number, each outcome's status, and the 404 of the endpoints it replaced) and its transaction with a fake client (statement order, the phase's settings, items and groups from the stored design, letters, the removal of phases never started, refusals and rollbacks, and the effects after the commit); in `ethicapp/frontend`, the service's single request and the dashboard's handling of an activity that moved on (409).
- The phase clock (#1111, epic #1105): in `ethicapp/backend`, `GET /activities/:id/clock` (the owner and the participants, the 401, 403 and 404 of every other requester, `Cache-Control: no-store`, a read failure, and the clock before the first phase, of a phase without a deadline, of an activity without a time mode, of the last phase, past its deadline and of a finished activity), the mapping of the clock's row, and the events: `onPhaseTransition` and `onPhaseClock` to both namespaces after a phase start, `onPhaseClock` after a clock change and `onPhaseDeadlineReached` to the teacher only, through fake namespaces and through real Socket.IO namespaces, with a failed emit or clock read logged and never thrown; and the payload that the phase start hands to them.
- Hiding students' names on the dashboard (#897): in `ethicapp/backend`, the assignment of pseudonym numbers with a fake database (the range switch, draws that follow neither the join order nor a sequence, a late joiner, numbers held by former participants, a collision retried, giving up after ten rounds) and the owner-only reads `GET /sessions/:id/pseudonyms` and `GET /phases/:id/groups` with each member's letter (student, another teacher, an anonymized owner, a super-admin who is not impersonating, the owner, an administrator impersonating the owner, unknown ids); in `management-console/backend`, the new user reference.
- Setting a user's password (#889): in `auth-backend`, the password policy module, the public policy endpoint, the policy on every route that sets a password, and the internal endpoint (internal service token, role, validation, target refusals, transaction order, no password in responses or logs), and the recovery route's refusal of a link revoked while the password was hashed; in `management-console/backend`, the route (step-up, refusals passed through, audit rows) and the auth-backend client; in `management-console/frontend`, the dialog.
- Creating an account (#1170): in `auth-backend`, the new account fields shared with sign-up, the internal endpoint (internal service token, role, validation in order, the insert, the duplicate email, the administrator's language for messages and the account's for the email, the best-effort welcome email, no password in responses or logs) and the welcome email in both locales; in `management-console/backend`, the route (privacy notice confirmation, step-up, refusals passed through, audit rows with the role and a failed welcome email) and the auth-backend client; in `management-console/frontend`, the password generator, the form rules, the error messages, the page and the notice on the new account's page.

The broader integration regression layer is not yet consistently implemented; `ethicapp/backend` has a first suite (section 1.2). Until it exists for a touched area, changes that rely on real database behavior should be manually verified against the local Docker Compose stack and should document that limitation in PR verification notes.

## 5. Adding or Changing Tests

When adding backend behavior:

- Add or update `*.node-test.mjs` guardrail tests for deterministic logic, authorization branches, input validation, and important error handling.
- Add focused integration tests when the risk involves real SQL behavior, schema compatibility, database constraints, transactions, migrations, or cross-service runtime behavior.
- Keep new tests scoped to the behavior being changed.
- Prefer dependency injection or module mocking over reaching into production configuration.
- Keep test data and expected user-facing technical labels in English.

When adding a new environment variable that tests depend on, keep the production environment contract and relevant `.env.example` files aligned.

## 6. Verification Expectations

For ordinary backend changes, minimum verification should include:

- the relevant local `npm test` command,
- the relevant service image build when its Dockerfile includes a test stage,
- manual Docker Compose verification for behavior not covered by guardrail tests,
- integration regression tests when available for the touched area.

PR descriptions should state:

- what tests were run,
- whether image build guardrails passed,
- whether database-integrated behavior was covered by automated integration tests or only manually verified,
- any remaining test gaps or residual risk.

## 7. Student Re-authentication Smoke Check

EthicApp activities are synchronous. After re-authentication, students should
explicitly choose their current classroom session rather than automatically
rejoin an activity from an earlier request.

For browser verification through the Compose stack:

1. Expire a signed-in student's auth session while the join form or an activity
   is open, then make a protected API call. Check that the expiry notice and
   its sign-in link lead to login without a previous code or activity target.
2. Sign in. Check that the student home page shows an empty code field and the
   sessions list, without submitting a join or opening a previous activity.
3. Enter the classroom code and submit, or select a session from the list.
   Check that this explicit action opens the chosen session.
4. Open `/student/?join=<valid-code>`. Check that the old query parameter does
   not prefill or automatically submit the join form.
