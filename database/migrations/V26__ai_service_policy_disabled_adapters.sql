-- Per-adapter switches in the AI service policy (epic #861, sub-issue #864).
--
-- Design notes:
--
-- A policy version allows AI Additions services as a whole
-- (allowed_service_ids, V22). Allowing a service enables every EthicApp
-- adapter whose `requires` it satisfies: allowing case-analyst enables three
-- case analyses and one design analysis. disabled_adapter_ids lists the
-- EthicApp adapter ids (manifest ids, for example
-- case-analyst-claim-typology) that the version switches off although their
-- services are allowed. An adapter is usable only when its services are
-- allowed and it is not listed here.
--
-- Existing versions disable nothing: the column defaults to an empty array,
-- so behaviour does not change until an operator saves a new version. Adding
-- a column with a constant default rewrites no row, so the append-only
-- trigger of V22 is not involved, and versions stay immutable afterwards.
--
-- Session hooks follow the session's pinned version, so a version saved
-- later never switches an adapter off in a running activity. Case and design
-- hooks follow the current version.

ALTER TABLE ai_service_policy_versions
ADD COLUMN IF NOT EXISTS disabled_adapter_ids text [] NOT NULL DEFAULT '{}';

ALTER TABLE ai_service_policy_versions
ADD CONSTRAINT ai_service_policy_versions_disabled_ids_check
CHECK (array_position(disabled_adapter_ids, NULL) IS NULL);
