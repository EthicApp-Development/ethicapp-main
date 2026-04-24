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
- `admin-panel/`: React 18 admin tooling application, primarily for user administration; currently not integrated/in active use.
- `nginx/`: NGINX configuration for development and production environments.
- `database/`: EthicApp database DDL and related SQL assets shared by all applications.
- `devops/`: deployment and environment automation scripts. Many are exposed from root `package.json` scripts.

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

Common repository-level commands (run from repository root when available):

```bash
npm run build
npm run lint-js
npm run lint-html
npm run lint-css
npm run lint-sql
npm run fix-js
npm run fix-css
npm run fix-sql
```

If a subproject has its own scripts, run its local build/test/lint commands from that subproject directory.

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
- Lint succeeds for modified languages/components.
- Core endpoint flows and helper logic paths are validated with basic cases.
- Any known limitations are explicitly documented in the PR.
