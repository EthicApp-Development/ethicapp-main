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
