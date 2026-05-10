# AGENTS Guide for `ethicapp-main`

This file defines working expectations for humans and coding agents operating in this repository.

## 1) Repository layout and important directories

This repository is a multi-project workspace. Important areas:

- `ethicapp/`: legacy EthicApp application (AngularJS 1.8 + Express).
  - Includes deprecated/aging student features.
  - Includes currently used teacher-facing features.
  - Includes admin-user functionality.
- `auth-backend/`: authentication app/service (login, logout, sign-up, password recovery, password change).
- `ethicapp-student/`: new student-focused application under active development (Vite + React 19 (JS) + Express).
- `management-console/`: super-admin management application for single-tenant operations (React + Vite + Bootstrap 5 frontend, Express backend, PostgreSQL access, and i18n aligned with `auth-backend`).
  - Base path is `/mng` (by design, avoid predictable `/admin` paths).
  - Uses auth proxy headers (`X-User-Id`, `X-User-Role`) and requires role `S`.
  - Includes user administration workflows (list/filter/pagination, account detail/edit, password reset trigger, and professor impersonation trigger).
- `nginx/`: NGINX configuration for development and production environments.
- `database/`: EthicApp database DDL and related SQL assets shared by all applications.
- `scripts/`: deployment and environment automation scripts. Many are exposed from root `package.json` scripts.

> Note: some directories may appear with repository-specific names (for example `dev-ops/`, `web-nginx/`, or `postgres-db/`) depending on branch/history. Prefer existing on-disk names when implementing changes.

## 2) How to run the project

- Preferred local development flow: **Docker Compose**.
- Backend apps are expected to run with **nodemon** in development.
- Frontend apps for `auth-backend` and `ethicapp-student` are expected to run with **Vite**.

Typical development start:

```bash
docker compose down --remove-orphans
docker compose up --build --detach
```

## 3) Build, test, and lint commands

Common build command for service images:

```bash
docker compose build
```

Some service image builds run backend tests as part of their Dockerfile stages. In particular:

- `docker compose build ethicapp` runs `npm test` in `ethicapp/backend` before building the final image.
- `docker compose build management-console` runs `npm test` in `management-console/backend` before building the final image.

Focused backend test commands:

```bash
cd ethicapp/backend && npm test
cd management-console/backend && npm test
```

Common repository-level commands (run from repository root when available):

```bash
npm run lint-js
npm run lint-html
npm run lint-css
npm run lint-sql
npm run fix-js
npm run fix-css
npm run fix-sql
```

If a subproject has its own scripts, run its local build/test/lint commands from that subproject directory.

When adding or changing backend behavior in `ethicapp/` or `management-console/`, prefer adding focused Node test coverage under the local backend test conventions (`*.node-test.mjs`). Keep tests deterministic, avoid depending on local-only config files, and make them safe to run both on the host and inside Docker build stages.

## 4) Engineering conventions and PR expectations

Given the mix of legacy code, prototype-quality code, and AI-assisted development, contributors should:

- Keep code clean, cohesive, and readable.
- Maintain clear separation of concerns and low coupling.
- Prefer factoring and refactoring opportunistically when safe.
- Favor evolutionary development (small, verifiable increments).
- Keep PRs focused and reviewable.
- In PR descriptions, include:
  - context/problem,
  - what changed,
  - risks/limitations,
  - verification steps.

## 5) Constraints and do-not rules

- **Do not** introduce dependencies with known security risks or dependencies that are obsolete.
- All new JavaScript dependencies must support **ES Modules**.
- Avoid adding new CommonJS code in new development.
- Avoid legacy JavaScript patterns in new modules.
- All newly implemented code (identifiers, comments, and user-facing technical labels) must be written in English.
- Minimize architectural and code anti-patterns, especially:
  - oversized monolithic components,
  - low-cohesion modules,
  - unnecessary coupling.

## 6) Definition of done and verification

A change is considered done when:

1. The implementation satisfies requirements.
2. Relevant endpoints and helper/business logic pass basic usage scenarios.
3. Applicable build/lint/test commands pass for the touched scope.
4. Manual verification steps are documented (and executed when possible).
5. No new security or dependency-policy violations are introduced.

Minimum verification checklist:

- Build succeeds for modified services/apps.
- Docker image builds pass for services whose Dockerfiles include test stages.
- Lint succeeds for modified languages/components.
- Focused tests pass for modified backend behavior.
- Core endpoint flows and helper logic paths are validated with basic cases.
- Any known limitations are explicitly documented in the PR.

## 7) Legacy EthicApp routing conventions (important)

For the legacy app inside `ethicapp/`, keep backend and frontend routing concerns separated and colocated:

- Backend Express bootstrapping and route registration live in `ethicapp/app.js`.
- Backend route handlers/controllers live in `ethicapp/backend/controllers/`.
- Legacy teacher AngularJS module wiring is under:
  - `ethicapp/frontend/assets/js/ngmodules/teacher/`
  - `ethicapp/frontend/assets/js/controllers/teacher/`
  - `ethicapp/frontend/assets/js/services/`
- Legacy teacher HTML templates are primarily under:
  - `ethicapp/frontend/views/partials/teacher/`
  - `ethicapp/frontend/assets/static/views/teacher/` (for static Angular partials used by new teacher CRUD flows)

When adding teacher-facing features in legacy EthicApp:

1. Register API routes via controller modules mounted from `ethicapp/app.js`.
2. Expose AngularJS services for API communication in `assets/js/services`.
3. Wire controllers/services in `teacher-admin.mjs`.
4. Add/update teacher navigation entry points in `ethicapp/frontend/views/home.ejs`.
5. When adding or modifying UI text in legacy EthicApp AngularJS views, add/update the corresponding translation keys in `ethicapp/frontend/assets/locales/` and use `{{'key'|translate}}` in templates instead of hardcoded strings.
6. For role-based authorization in legacy backend endpoints, prefer `requireRole` from `ethicapp/backend/helpers/auth-helper.js`; it accepts either a single role (`"P"`) or an array (for example `["P", "A"]`) for professor/student shared access.
7. For teacher view actions, prefer Bootstrap 3 small default buttons (`btn btn-default btn-sm`) unless the action semantics require another contextual style.

## 8) Translation and i18n policy (auth-backend + management-console + ethicapp)

Use this policy for all new i18n-related changes in this repository.

### Locale policy (canonical rule)

- Supported locales are:
  - `es_CL`
  - `en_US`
- Locale normalization rule:
  - If browser/request locale is `es_*` (or `es`), normalize to `es_CL`.
  - Otherwise, normalize to `en_US`.
- In other words: Spanish is used **only** when the client explicitly prefers Spanish; every other locale falls back to English.

### `auth-backend` i18n implementation

- Frontend (`auth-backend/frontend/`):
  - Uses a lightweight i18n provider (`src/app/providers.jsx`) exposed through `useI18n()`.
  - Locale detection/normalization lives in `src/i18n/languages.js`.
  - Translation catalogs live in `src/i18n/locales/` and are registered in `src/i18n/translations.js`.
  - New UI text must use translation keys via `t(...)`, not hardcoded strings.
- Legal/static content:
  - Privacy and terms are maintained as locale-specific markdown under `src/content/legal/`.
  - Rendering is done through reusable legal/markdown components in `src/components/common/`.
- Backend (`auth-backend/routes/auth.routes.js`):
  - API messages must be localized (no hardcoded single-language responses).
  - Request locale must be inferred/normalized from `preferred_locale` and/or browser headers (`Accept-Language`) using the canonical policy.
- Email templates:
  - Keep locale-specific templates under `auth-backend/views/emails/` (for example `*.es_CL.ejs`, `*.en_US.ejs`).
  - `auth-backend/services/mail.service.js` is responsible for locale resolution and selecting subject/template by locale.

### `management-console` i18n implementation

- Frontend (`management-console/frontend/`):
  - Uses a lightweight i18n provider pattern compatible with `auth-backend`.
  - Locale detection/normalization follows canonical rule (`es_*` => `es_CL`, else `en_US`).
  - Translation catalogs live under `src/i18n/locales/`.
  - New UI text must use translation keys (no hardcoded strings in components/pages).
- Backend (`management-console/backend/`):
  - Error and response messages exposed to users should be localizable as the project evolves.
  - Security-sensitive workflows (for example admin confirmation and impersonation flows) must keep user-facing messages consistent with selected locale.

### `ethicapp` i18n implementation

- Legacy teacher AngularJS app currently determines language from browser preferences (`$translateProvider.determinePreferredLanguage()`), with configured fallback.
- User locale persistence uses `preferred_locale` at database level (not legacy `lang`).
- When reading/updating user locale in backend controllers/helpers, use `preferred_locale` and apply the same normalization rule (`es_*` => `es_CL`, else `en_US`).

### Translation change checklist

When adding/changing translatable features:

1. Add/update keys in both `es_CL` and `en_US`.
2. Replace hardcoded user-facing strings with translation keys.
3. Ensure API/email/user-flow messages are localized as applicable.
4. Ensure locale inference/normalization follows the canonical rule above.
5. If DB locale defaults or schema are touched, keep naming as `preferred_locale` and defaults aligned with the policy.
