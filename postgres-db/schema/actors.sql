CREATE TABLE actor_selection (
    id integer PRIMARY KEY,
    description text NOT NULL,
    orden integer,
    actorid integer,
    uid integer,
    stageid integer,
    stime timestamp without time zone DEFAULT now()
);

CREATE TABLE public.actors (
    id serial PRIMARY KEY,
    name character varying(255) NOT NULL,
    jorder boolean NOT NULL,
    stageid integer,
    justified boolean DEFAULT true,
    word_count integer DEFAULT 0
);
