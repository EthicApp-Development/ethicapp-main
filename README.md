# EthicApp 2

EthicApp is a multi-application workspace for case-based ethics education in Higher Education. The current architecture is composed of several services exposed through NGINX:

- `ethicapp/`: legacy EthicApp application. It still contains the active teacher-facing frontend in AngularJS and the legacy Express backend.
- `auth-backend/`: authentication service and React + Vite authentication frontend.
- `ethicapp-student/`: student-facing application under active development, built with React + Vite and Express.
- `management-console/`: super-admin management console built with React + Vite, Bootstrap 5, Express, and PostgreSQL access.
- `nginx/`: development and production NGINX facade for the applications.
- `database/`: PostgreSQL schema, migrations, and seed assets used by the database container.
- `canonical-schemas/`: JSON Schemas for portable EthicApp objects, including activity designs and rendered case-document representations.
- `scripts/`: helper scripts exposed through the root `package.json`.

For repository conventions and agent/human working expectations, also review [`AGENTS.md`](./AGENTS.md). It contains important routing, i18n, and implementation guidance.

- [EthicApp 2](#ethicapp-2)
  - [1. Developing](#1-developing)
  - [2. Required Skills](#2-required-skills)
  - [3. Runtime Dependencies](#3-runtime-dependencies)
  - [4. Environment Files](#4-environment-files)
    - [4.1. Root environment](#41-root-environment)
    - [4.2. Service environment files](#42-service-environment-files)
    - [4.3. Auth backend bootstrap variables](#43-auth-backend-bootstrap-variables)
  - [5. Local Development](#5-local-development)
    - [5.1. Start the application](#51-start-the-application)
    - [5.2. Logs and shell access](#52-logs-and-shell-access)
    - [5.3. Database initialization](#53-database-initialization)
  - [6. Case Document Rendering](#6-case-document-rendering)
  - [7. Static Assets and Builds](#7-static-assets-and-builds)
    - [7.1. Legacy EthicApp assets](#71-legacy-ethicapp-assets)
    - [7.2. React + Vite applications](#72-react--vite-applications)
  - [8. Tests](#8-tests)
    - [8.1. Backend tests](#81-backend-tests)
    - [8.2. Docker build test stages](#82-docker-build-test-stages)
    - [8.3. Integration regression tests](#83-integration-regression-tests)
  - [9. Useful Root Scripts](#9-useful-root-scripts)
  - [10. Production](#10-production)

## 1. Developing

Preferred development environments are:

- Linux with Docker.
- Windows with WSL2 and Docker.
- macOS with Docker.

The supported local workflow is Docker Compose. Running the full application natively is not recommended because the project is now several applications routed through NGINX.

## 2. Required Skills

Contributors should be comfortable with:

- JavaScript.
- HTML.
- CSS.
- Node.js and npm.
- Docker and Docker Compose.

AngularJS is still needed to maintain the legacy teacher-facing frontend in `ethicapp/`. New frontend development should use React + Vite, following the patterns in `auth-backend/`, `ethicapp-student/`, and `management-console/`.

PostgreSQL knowledge is useful when working on schema, migrations, seeds, reports, or backend data access.

## 3. Runtime Dependencies

For local runtime, install:

- Docker.
- Docker Compose, usually available as `docker compose` in current Docker installations.

Root npm dependencies are useful for linting and legacy asset build scripts:

```bash
npm install
```

Service dependencies are normally installed inside containers during the development Compose flow.

## 4. Environment Files

The project uses environment variables only. Legacy password files and Compose secret files are no longer part of the development setup.

### 4.1. Root environment

The root files are required by Compose:

- `.env`: root runtime flags, such as `NODE_ENV`.
- `.env.shared`: database, SMTP, proxy, SQL debug, and reCAPTCHA values shared by multiple services.

Use the example files as the starting point when setting up a new checkout:

```bash
cp .env.example .env
cp .env.shared.example .env.shared
```

### 4.2. Service environment files

Each application can also define service-specific configuration:

- `ethicapp/.env`
- `auth-backend/.env`
- `ethicapp-student/.env`
- `ethicapp-student/backend/.env`
- `management-console/.env`

When an `.env.example` exists beside a service `.env`, copy it and adjust local values as needed.

### 4.3. Auth backend bootstrap variables

`auth-backend/.env` includes bootstrap controls for local and test data:

- `CREATE_ADMIN`: when enabled, creates or ensures the configured admin user exists.
- `ADMIN_FIRSTNAME`, `ADMIN_LASTNAME`, `ADMIN_DNI`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_SEX`: credentials and profile values for the bootstrap administrator.
- `SEED_USERS`: when enabled, runs test-user seed logic.
- `WAIT_FOR_DB`: makes the service wait for PostgreSQL before bootstrapping.

Treat these as development/bootstrap settings. Use strong credentials and production-appropriate values outside local development.

## 5. Local Development

### 5.1. Start the application

Use Docker Compose from the repository root for local development. The recommended project name is `ethicapp`, so all containers and volumes are grouped in a predictable namespace and do not collide with other local projects:

```bash
docker compose -p ethicapp down --remove-orphans
docker compose -p ethicapp up --build --detach
```

NGINX exposes the application facade at:

```text
http://localhost
```

The Compose setup starts PostgreSQL, Redis, NGINX, the legacy EthicApp service, the PDF render worker, the auth service, the student app, and the management console. Production Compose or orchestration templates belong to the deployment repository and should consume this repository's published images plus `deploy/` contract files.

### 5.2. Logs and shell access

Follow logs for a service:

```bash
docker compose -p ethicapp logs -f nginx
docker compose -p ethicapp logs -f auth-backend
docker compose -p ethicapp logs -f ethicapp
docker compose -p ethicapp logs -f ethicapp-pdf-worker
docker compose -p ethicapp logs -f ethicapp-student
docker compose -p ethicapp logs -f management-console
docker compose -p ethicapp logs -f postgresql
```

Open a shell in a running service:

```bash
docker compose -p ethicapp exec auth-backend sh
```

### 5.3. Database initialization

Database migrations and initialization scripts in `database/` run automatically when the PostgreSQL container initializes its data volume.

If you need a clean database, stop the stack and remove the Compose volume for the `ethicapp` project, then start the stack again. This deletes local database state.

## 6. Case Document Rendering

EthicApp stores uploaded case PDFs behind authorization-aware upload routes. A separate `ethicapp-pdf-worker` service consumes `pdf_render_jobs` rows and converts case PDFs into:

- extracted raw text,
- ordered PNG page images under the protected uploads volume,
- a canonical case-document representation manifest.

The manifest schema lives in [`canonical-schemas/case-document-representation-v1.schema.json`](./canonical-schemas/case-document-representation-v1.schema.json). The legacy teacher UI and the student React app prefer rendered page images when available, and fall back to the protected PDF while processing is pending or unavailable.

Local development uses `PDF_RENDER_DPI=200` by default to keep rendered pages sharp on high-density displays. Other worker settings are exposed through `PDF_RENDER_*` variables in `ethicapp/.env.example` and the production environment contract.

The worker shares the protected `uploads` volume with `ethicapp`, but uses its own backend `node_modules` volume so development-time dependency installs do not race with the web service.

## 7. Static Assets and Builds

### 7.1. Legacy EthicApp assets

The legacy teacher frontend in `ethicapp/frontend` requires bundled static assets. In Docker development, the `ethicapp` container starts the asset watcher from its entrypoint, so host-side `build-devel` and `watch-devel` scripts are no longer used.

```bash
docker compose up --build
```

The container performs the initial development build and then watches the legacy asset inputs for changes.

For production-style legacy assets, run the one-shot build from the host through Docker:

```bash
npm run build:ethicapp-assets
```

The `ethicapp` Docker image also runs this production asset build while the image is built.

### 7.2. React + Vite applications

The newer frontends use React + Vite:

- `auth-backend/frontend`
- `ethicapp-student/frontend`
- `management-console/frontend`

In the Docker development flow, Vite is started by the root `docker-compose.yml`. For focused work inside a subproject, use that subproject's local npm scripts.

## 8. Tests

The repository uses a layered testing strategy. The first layer is lightweight guardrail coverage: deterministic Node.js tests that use mocks, fakes, or in-memory Express apps and are safe to run during Docker image builds. The second planned layer is broader integration regression coverage against real infrastructure, especially PostgreSQL, for development and CI verification. See [`TESTING.md`](./TESTING.md) for the full testing policy.

At the moment, automated coverage is mostly the lightweight guardrail layer. These tests use the built-in Node.js test runner and live beside the backend code they exercise.

### 8.1. Backend tests

Run focused backend suites from each service directory:

```bash
cd ethicapp/backend
npm test
```

```bash
cd auth-backend
npm test
```

```bash
cd management-console/backend
npm test
```

Current coverage includes:

- `ethicapp/backend`: upload middleware behavior for PDF validation, size limits, wrong fields, temporary cleanup, final file moves, protected upload authorization, and PDF render job status helpers.
- `auth-backend`: CSRF protection plus authentication route behavior for login, registration validation, duplicate account handling, locale normalization, forgot-password token creation, and password reset.
- `management-console/backend`: professor impersonation route behavior, including reCAPTCHA rejection, role rejection, and EthicApp session cookie forwarding.

### 8.2. Docker build test stages

The production image builds for these services run backend tests during Docker build:

```bash
docker compose build ethicapp
docker compose build auth-backend
docker compose build management-console
```

If those tests fail, the image build fails. This keeps the local Compose build path aligned with the minimum verification expected before merging backend changes.

The tests executed during image build must stay fast, deterministic, and independent from running services. They should not require PostgreSQL, Redis, SMTP, external HTTP APIs, or local-only configuration. When database behavior needs to be covered in this layer, use mocks/fakes and assert the service contract, SQL shape, transaction flow, or error handling path.

### 8.3. Integration regression tests

Integration regression tests are intended to validate behavior that lightweight guardrails cannot prove, including real PostgreSQL schema compatibility, constraints, transactions, migrations/seeds, and cross-service session or proxy flows. These tests should run as a dedicated development/CI step, not as part of Docker image construction.

This layer is not yet consistently implemented. Until it exists for a touched area, changes that depend on real database behavior should be manually verified against the local Docker Compose stack and should document that limitation in PR verification notes. The intended conventions for this layer are documented in [`TESTING.md`](./TESTING.md).

## 9. Useful Root Scripts

The root [`package.json`](./package.json) includes helper scripts for development and maintenance:

| Script | Description |
| --- | --- |
| `lint-js` | Runs JavaScript lint checks for the legacy app scope configured in the root package. |
| `lint-html` | Runs HTML lint checks for configured legacy templates. |
| `lint-css` | Runs CSS lint checks for configured legacy styles. |
| `lint-sql` | Runs SQL lint checks. |
| `fix-js` | Applies automatic JavaScript lint fixes where supported. |
| `fix-css` | Applies automatic CSS lint fixes where supported. |
| `fix-sql` | Applies automatic SQL lint fixes where supported. |
| `build:ethicapp-assets` | Builds production-style legacy EthicApp frontend assets through Docker. |
| `publish:ghcr` | Builds and publishes EthicApp project images to GitHub Container Registry. |
| `psql` | Opens a PostgreSQL client against the containerized development database. |
| `pgdump` | Dumps the containerized development database to `database/dumps/` or a provided path. |
| `pgrestore` | Restores the containerized development database from a provided dump path. |
| `clear-sessions` | Clears local legacy session files when needed for debugging. |

## 10. Production

For production image publishing and deployment notes, see [`INSTALL.md`](./INSTALL.md) and [`deploy/README.md`](./deploy/README.md). Production values must be provided through environment variables and should not reuse local development credentials. Deploy the PDF render worker as a separate process using the same `ethicapp` image with `ETHICAPP_PROCESS_ROLE=pdf-render-worker`, the same protected uploads volume, and the `PDF_RENDER_*` variables from [`deploy/env.contract.yml`](./deploy/env.contract.yml).
