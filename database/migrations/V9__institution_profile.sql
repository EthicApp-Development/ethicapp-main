CREATE TABLE IF NOT EXISTS institution (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    name text NOT NULL DEFAULT '',
    logo_filename text,
    logo_mime_type varchar(50),
    logo_bytes bytea,
    logo_updated_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT NOW(),
    updated_at timestamp without time zone DEFAULT NOW()
);

INSERT INTO institution (id, name)
VALUES (1, '')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS institutional_contacts (
    id serial PRIMARY KEY,
    institution_id smallint NOT NULL DEFAULT 1 REFERENCES institution(id) ON DELETE CASCADE,
    contact_type varchar(20) NOT NULL CHECK (contact_type IN ('technical', 'academic')),
    firstname text NOT NULL DEFAULT '',
    lastname text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',
    phone_country_code varchar(10) NOT NULL DEFAULT '',
    phone_number varchar(30) NOT NULL DEFAULT '',
    created_at timestamp without time zone DEFAULT NOW(),
    updated_at timestamp without time zone DEFAULT NOW(),
    UNIQUE (institution_id, contact_type)
);

INSERT INTO institutional_contacts (institution_id, contact_type)
VALUES
    (1, 'technical'),
    (1, 'academic')
ON CONFLICT (institution_id, contact_type) DO NOTHING;
