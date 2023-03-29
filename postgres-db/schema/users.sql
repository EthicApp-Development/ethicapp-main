CREATE TYPE tipo_aprendizaje AS ENUM (
    'Reflexivo',
    'Activo',
    'Teorico',
    'Pragmatico'
);

CREATE TABLE users (
    id serial PRIMARY KEY,
    "name" text NOT NULL,
    "rut" text NOT NULL,
    pass text NOT NULL,
    mail text NOT NULL,
    sex character(1),
    "role" character(1),
    aprendizaje public.tipo_aprendizaje,
    section character varying(16),
    lang character varying(10) DEFAULT 'spanish'::character varying,
    "disabled" boolean
);
