-- AI Additions connection, versioned AI service policy and the session pin
-- (epic #810, sub-issue #813).
--
-- Design notes:
--
-- ai_additions_connection holds at most one row: where EthicApp reaches AI
-- Additions. No row means no connection, and then EthicApp makes no AI calls.
-- The connection is infrastructure, so it is not versioned: running sessions
-- follow it when it changes. keycloak_public_url is optional; consumers default
-- it to base_url + '/keycloak'.
--
-- ai_service_policy_versions is append-only: each saved policy is a new,
-- immutable version listing the AI Additions service ids it allows. The current
-- policy is the version with the highest id. Version 1 allows nothing, so an
-- installation uses no AI until an operator saves a new version. A trigger
-- rejects UPDATE, DELETE and TRUNCATE, which lets readers cache versions
-- without expiry.
--
-- sessions.ai_service_policy_version_id pins each session to the policy its
-- activity runs under. Every session that exists when this migration runs is
-- pinned to version 1, so AI stops in sessions already running (epic decision
-- of 2026-10-25). New sessions take the current version as a column default,
-- and the activity launch transaction re-pins the session to the version
-- current at launch, once, while the session has no activity yet. Later
-- versions never change the pin of a launched session.
--
-- ethicapp only writes the pin. The management console writes the connection
-- and the versions.

CREATE TABLE IF NOT EXISTS ai_additions_connection (
    id smallint NOT NULL DEFAULT 1,
    base_url text NOT NULL,
    keycloak_public_url text NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by integer NULL,
    CONSTRAINT ai_additions_connection_pkey PRIMARY KEY (id),
    CONSTRAINT ai_additions_connection_single_row_check CHECK (id = 1),
    CONSTRAINT ai_additions_connection_base_url_check
    CHECK (base_url ~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'),
    CONSTRAINT ai_additions_connection_keycloak_public_url_check
    CHECK (
        keycloak_public_url IS NULL
        OR keycloak_public_url ~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
    ),
    CONSTRAINT ai_additions_connection_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES users (id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_service_policy_versions (
    id bigserial NOT NULL,
    allowed_service_ids text[] NOT NULL,
    note text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by integer NULL,
    CONSTRAINT ai_service_policy_versions_pkey PRIMARY KEY (id),
    CONSTRAINT ai_service_policy_versions_allowed_ids_check
    CHECK (array_position(allowed_service_ids, NULL) IS NULL),
    CONSTRAINT ai_service_policy_versions_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users (id)
);

CREATE OR REPLACE FUNCTION reject_ai_service_policy_version_change()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'ai_service_policy_versions is append-only: % is not allowed.', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_service_policy_versions_append_only
ON ai_service_policy_versions;
CREATE TRIGGER ai_service_policy_versions_append_only
BEFORE UPDATE OR DELETE
ON ai_service_policy_versions
FOR EACH ROW
EXECUTE FUNCTION reject_ai_service_policy_version_change();

DROP TRIGGER IF EXISTS ai_service_policy_versions_no_truncate
ON ai_service_policy_versions;
CREATE TRIGGER ai_service_policy_versions_no_truncate
BEFORE TRUNCATE
ON ai_service_policy_versions
FOR EACH STATEMENT
EXECUTE FUNCTION reject_ai_service_policy_version_change();

INSERT INTO ai_service_policy_versions (id, allowed_service_ids, note)
VALUES (1, '{}', 'Initial policy: no AI services are allowed.');

SELECT setval(pg_get_serial_sequence('ai_service_policy_versions', 'id'), 1);

CREATE OR REPLACE FUNCTION current_ai_service_policy_version_id()
RETURNS bigint AS $$
    SELECT max(id) FROM ai_service_policy_versions;
$$ LANGUAGE sql STABLE;

ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS ai_service_policy_version_id bigint NULL;

UPDATE sessions
SET ai_service_policy_version_id = 1
WHERE ai_service_policy_version_id IS NULL;

ALTER TABLE sessions
ALTER COLUMN ai_service_policy_version_id
SET DEFAULT current_ai_service_policy_version_id(),
ALTER COLUMN ai_service_policy_version_id SET NOT NULL,
ADD CONSTRAINT sessions_ai_service_policy_version_fkey
FOREIGN KEY (ai_service_policy_version_id)
REFERENCES ai_service_policy_versions (id);

CREATE INDEX IF NOT EXISTS idx_sessions_ai_service_policy_version_id
ON sessions (ai_service_policy_version_id);
