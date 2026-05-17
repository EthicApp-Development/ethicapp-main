CREATE TABLE IF NOT EXISTS users (
    id serial PRIMARY KEY,
    name text NOT NULL,
    rut text NOT NULL,
    pass text,
    mail text NOT NULL CONSTRAINT users_mail_unique UNIQUE,
    sex char(1),
    role char(1),
    preferred_locale varchar(10) DEFAULT 'en_US',
    password_bcrypt text,
    auth_provider varchar(20) DEFAULT 'local',
    last_login_at timestamp without time zone,
    active boolean DEFAULT true,
    firstname varchar(255),
    lastname varchar(255),
    profile_image_path text,
    profile_image_topbar_path text
);

CREATE INDEX IF NOT EXISTS idx_users_mail ON users(mail);
CREATE INDEX IF NOT EXISTS idx_users_rut ON users(rut);

CREATE TABLE IF NOT EXISTS sessions (
    id serial PRIMARY KEY,
    name text NOT NULL,
    descr text,
    status integer,
    time timestamp with time zone,
    creator integer REFERENCES users(id),
    code char(6),
    type char(1),
    options varchar(16) DEFAULT 'J',
    archived boolean DEFAULT false,
    current_phase_id integer
);

CREATE TABLE IF NOT EXISTS phases (
    id serial PRIMARY KEY,
    phase_number integer NOT NULL,
    phase_type varchar(15) NOT NULL,
    anonymous boolean DEFAULT false,
    chat_enabled boolean DEFAULT false,
    previous_answers varchar(255),
    session_id integer REFERENCES sessions(id),
    question text,
    grouping varchar(63),
    options text
);

ALTER TABLE sessions
ADD CONSTRAINT sessions_current_phase_fkey
FOREIGN KEY (current_phase_id) REFERENCES phases(id);

CREATE TABLE IF NOT EXISTS sessions_users (
    session_id integer NOT NULL REFERENCES sessions(id),
    user_id integer NOT NULL REFERENCES users(id),
    device varchar(255),
    PRIMARY KEY (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_users_user_id ON sessions_users(user_id);

CREATE TABLE IF NOT EXISTS groups (
    id serial PRIMARY KEY,
    session_id integer REFERENCES sessions(id),
    phase_id integer REFERENCES phases(id)
);

CREATE TABLE IF NOT EXISTS groups_users (
    group_id integer REFERENCES groups(id),
    user_id integer REFERENCES users(id),
    anon_mask char(1),
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_groups_users_group_id ON groups_users(group_id);
CREATE INDEX IF NOT EXISTS idx_groups_users_user_id ON groups_users(user_id);
