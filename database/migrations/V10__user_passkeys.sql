-- WebAuthn passkeys registered by administrator users.
CREATE TABLE IF NOT EXISTS user_passkeys (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id text NOT NULL UNIQUE,
    credential_public_key bytea NOT NULL,
    counter bigint NOT NULL DEFAULT 0,
    credential_device_type varchar(40),
    credential_backed_up boolean NOT NULL DEFAULT false,
    transports text[] NOT NULL DEFAULT ARRAY[]::text[],
    name text,
    created_at timestamp without time zone NOT NULL DEFAULT NOW(),
    last_used_at timestamp without time zone
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_id ON user_passkeys(user_id);
