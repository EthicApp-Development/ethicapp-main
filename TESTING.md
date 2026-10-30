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

Canonical schemas (`canonical-schemas/`) have their own guardrail tests at the repository root: `npm run test:schemas` validates example and seed documents against the JSON Schemas with `@cfworker/json-schema`. They run on the host, not during image builds, because no image ships the schemas.

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

Current integration suites:

- `ethicapp/backend`: `npm run test:integration` runs `**/*.integration-test.mjs` against the database in `ETHICAPP_INTEGRATION_DATABASE_URL`, which must have migrations V1 to V28 or later applied. When the variable is unset, the suites are skipped with a message saying so. They insert rows that are not cleaned up (AI service policy versions are append-only), so point them at a disposable database. For example:

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

  The first suite covers the activity launch transaction and the AI service policy pin, including two concurrent launches of the same session. Others cover pending callback results and their concurrent claim (V23), and room-scoped jobs (V24): opening, supersession, closing, and the refusal of a callback to a closed room job; and design analyses (V25): reservation, in-flight and stale generations, conditional completion and failure, replacement of the previous document, deletion with the design, reservation on save (unchanged input hash, supersession of a generation in flight), and the copy of ready analyses to a duplicated design; and the adapters a policy version switches off (V26): the empty default for existing and new versions, the stored list as the policy store reads it, the rejection of NULL ids, and the append-only rule; and the student activity descriptor of an activity in progress and of a finished one, which has no current phase; and the selection and finishing of a teacher's open activities (initiated, in progress, or without a status), which a second call finds nothing left of; and the account creation time (V28): the column default dates new accounts, and replaying the migration leaves existing accounts without a date instead of backfilling them.

- `management-console/backend`: `npm run test:integration` runs `**/*.integration-test.mjs` against the same kind of database, with migrations V1 to V27 or later applied, and reads the same `ETHICAPP_INTEGRATION_DATABASE_URL`, so one disposable database serves both suites. Run it from `management-console/backend` in place of `ethicapp/backend` in the example above. It covers the confirmation of a pending account and the administrator audit log (V27): the account activated and its confirmation tokens deleted, the refusal of active, deactivated and anonymized accounts, two concurrent confirmations of the same account, the append-only rule of `admin_audit_events`, and the checks that keep free text out of it. The accounts and audit events it inserts are not removed.

### 1.3. End-to-End and Smoke Tests

End-to-end and smoke tests are appropriate for validating the full Compose stack or release candidates.

Purpose:

- Validate NGINX routing, service boundaries, runtime configuration, cookies, sessions, and key user flows.
- Confirm that frontend and backend services cooperate correctly after images are built.

These tests should be a separate CI/release step, not part of service Dockerfile builds.

`npm run test:nginx-edge` (`scripts/test-nginx-edge.sh`) is a first check of this kind. It builds the `nginx` image, runs it with both the production template and `dev.conf` against stub upstreams on a private Docker network, and verifies how the edge answers missing sessions, outages, request ids, and internal-only routes. It needs Docker but none of the application services.

`npm run test:nginx-config` is the static counterpart for internal-only routes. It parses both configurations without Docker and checks that the location NGINX selects for each internal `/api/admin/` route is the blocking `location ^~ /api/admin/`.

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
- `management-console/backend`: CSRF protection and professor impersonation route behavior, including reCAPTCHA rejection, role rejection, and EthicApp session cookie forwarding; the confirmation of a pending account (route, step-up, transaction order, refusals) and the administrator audit helper.

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
