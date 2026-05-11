# EthicApp Configuration Contract

`env.contract.yml` is the canonical environment-variable contract for EthicApp.

Deployment repositories should consume this file from the same git tag as the Docker images being deployed. The deployment repository should provide environment-specific values and secrets, then render the concrete `.env` files required by Docker Compose or the target runtime.

Recommended deployment flow:

1. Select an EthicApp release tag.
2. Fetch `config/env.contract.yml` from that tag.
3. Validate the deployment environment values against the contract.
4. Render runtime-specific `.env` files from the contract projections.
5. Deploy the images built from the same release tag.

The contract distinguishes:

- `secret: true`: values that must come from a secret manager or protected deployment store.
- `phase: build`: values required while building frontend assets.
- `phase: runtime`: values required when containers start.
- `phase: build-and-runtime`: values needed in both places.

All `VITE_*` variables are public frontend variables. They must never contain secrets.

Vite reads `VITE_*` variables when frontend assets are built, so EthicApp uses a
per-environment image strategy for production deployments. The deployment pipeline
must build and tag images with the intended public values for the target environment
instead of expecting those values to change when a container starts.

Redis is role-specific in production. Use `REDIS_SESSION_*` for Express session
storage and `REDIS_CACHE_*` for database-derived cache entries. Development may map
both roles to the same Redis instance. The default production memory limits are
`REDIS_SESSION_MAXMEMORY=128mb` and `REDIS_CACHE_MAXMEMORY=256mb`.
