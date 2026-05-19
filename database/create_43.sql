CREATE TABLE IF NOT EXISTS external_service_agents (
    id serial,
    service_id text NOT NULL,
    display_name text NOT NULL,
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT external_service_agents_service_id_unique UNIQUE (service_id)
);

ALTER TABLE chat
ADD COLUMN IF NOT EXISTS external_agent_id integer references external_service_agents(id);

ALTER TABLE differential_chat
ADD COLUMN IF NOT EXISTS external_agent_id integer references external_service_agents(id);

CREATE INDEX IF NOT EXISTS idx_chat_external_agent_id ON chat(external_agent_id);
CREATE INDEX IF NOT EXISTS idx_differential_chat_external_agent_id
ON differential_chat(external_agent_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE contype = 'p'
          AND conrelid = 'activity'::regclass
    ) THEN
        ALTER TABLE activity
        ADD CONSTRAINT activity_pk
        PRIMARY KEY (id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS activity_report_exports (
    id serial PRIMARY KEY,
    activity_id integer REFERENCES activity(id) ON DELETE SET NULL,
    session_id integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    design_id integer REFERENCES designs(id) ON DELETE SET NULL,
    report_type text NOT NULL CHECK (report_type IN ('full_report', 'chat_transcript')),
    export_format text NOT NULL DEFAULT 'csv',
    design_type text,
    actor_user_id integer REFERENCES users(id) ON DELETE SET NULL,
    effective_user_id integer REFERENCES users(id) ON DELETE SET NULL,
    actor_role text,
    effective_role text,
    impersonated boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed', 'failed')),
    requested_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    row_count integer,
    byte_count integer,
    content_sha256 text,
    ip_address inet,
    user_agent text,
    request_id text,
    error_message text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_activity_report_exports_requested_at
    ON activity_report_exports(requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_report_exports_actor_user_id
    ON activity_report_exports(actor_user_id);

CREATE INDEX IF NOT EXISTS idx_activity_report_exports_effective_user_id
    ON activity_report_exports(effective_user_id);

CREATE INDEX IF NOT EXISTS idx_activity_report_exports_session_id
    ON activity_report_exports(session_id);

CREATE INDEX IF NOT EXISTS idx_activity_report_exports_report_type_requested_at
    ON activity_report_exports(report_type, requested_at DESC);
