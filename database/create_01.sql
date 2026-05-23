-- Base EthicApp schema.
-- This script intentionally keeps only the tables still used by the active
-- EthicApp services after the legacy route cleanup.

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
    profile_image_topbar_path text,
    email_confirmed boolean DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_users_mail ON users(mail);
CREATE INDEX IF NOT EXISTS idx_users_rut ON users(rut);

CREATE TABLE IF NOT EXISTS pass_reset (
    id serial PRIMARY KEY,
    mail text NOT NULL,
    token varchar(64) NOT NULL,
    ctime timestamp
);

CREATE INDEX IF NOT EXISTS idx_pass_reset_mail ON pass_reset(mail);
CREATE INDEX IF NOT EXISTS idx_pass_reset_token ON pass_reset(token);

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
    current_stage integer
);

CREATE TABLE IF NOT EXISTS sesusers (
    sesid integer REFERENCES sessions(id),
    uid integer REFERENCES users(id),
    device varchar(255),
    CONSTRAINT no_dup_users UNIQUE(uid, sesid)
);

CREATE TABLE IF NOT EXISTS stages (
    id serial PRIMARY KEY,
    number integer NOT NULL,
    type varchar(15) NOT NULL,
    anon boolean DEFAULT false,
    chat boolean DEFAULT false,
    prev_ans varchar(255),
    sesid integer REFERENCES sessions(id),
    question text,
    grouping varchar(63),
    options text
);

ALTER TABLE sessions
ADD CONSTRAINT sessions_current_stage_fkey
FOREIGN KEY (current_stage) REFERENCES stages(id);

CREATE TABLE IF NOT EXISTS teams (
    id serial PRIMARY KEY,
    sesid integer REFERENCES sessions(id),
    leader integer REFERENCES users(id),
    stageid integer REFERENCES stages(id)
);

CREATE TABLE IF NOT EXISTS teamusers (
    tmid integer REFERENCES teams(id),
    uid integer REFERENCES users(id),
    anon_mask char(1)
);

CREATE INDEX IF NOT EXISTS idx_teamusers_tmid ON teamusers(tmid);
CREATE INDEX IF NOT EXISTS idx_teamusers_uid ON teamusers(uid);

CREATE TABLE IF NOT EXISTS actors (
    id serial PRIMARY KEY,
    name varchar(255) NOT NULL,
    jorder boolean NOT NULL,
    stageid integer REFERENCES stages(id),
    justified boolean DEFAULT true,
    word_count integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS actor_selection (
    id serial PRIMARY KEY,
    description text NOT NULL,
    orden integer,
    actorid integer REFERENCES actors(id),
    uid integer REFERENCES users(id),
    stageid integer REFERENCES stages(id),
    stime timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat (
    id serial PRIMARY KEY,
    sesid integer REFERENCES sessions(id),
    stageid integer REFERENCES stages(id),
    uid integer REFERENCES users(id),
    content text,
    stime timestamp DEFAULT now(),
    parent_id integer REFERENCES chat(id),
    tmid integer REFERENCES teams(id)
);

CREATE INDEX IF NOT EXISTS idx_chat_tmid ON chat(tmid);

CREATE TABLE IF NOT EXISTS differential (
    id serial PRIMARY KEY,
    title text DEFAULT '',
    tleft text NOT NULL,
    tright text NOT NULL,
    orden integer NOT NULL,
    creator integer REFERENCES users(id),
    sesid integer REFERENCES sessions(id),
    stageid integer REFERENCES stages(id),
    justify boolean DEFAULT true,
    num integer DEFAULT 7,
    word_count integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS differential_selection (
    id serial PRIMARY KEY,
    uid integer REFERENCES users(id),
    did integer REFERENCES differential(id),
    sel integer NOT NULL,
    iteration integer,
    comment text,
    stime timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS differential_chat (
    id serial PRIMARY KEY,
    uid integer REFERENCES users(id),
    did integer REFERENCES differential(id),
    content text,
    stime timestamp DEFAULT now(),
    parent_id integer REFERENCES differential_chat(id),
    tmid integer REFERENCES teams(id)
);

CREATE INDEX IF NOT EXISTS idx_differential_chat_tmid ON differential_chat(tmid);

CREATE TABLE IF NOT EXISTS jigsaw_role (
    id serial PRIMARY KEY,
    name varchar(255) NOT NULL,
    description text,
    sesid integer REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS jigsaw_users (
    stageid integer REFERENCES stages(id),
    userid integer REFERENCES users(id),
    roleid integer REFERENCES jigsaw_role(id)
);
