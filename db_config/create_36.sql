CREATE TABLE IF NOT EXISTS designs (
    id serial,
    creator integer,
    design jsonb,
    FOREIGN KEY(creator) REFERENCES users(id)
);

ALTER TABLE designs
ADD public boolean DEFAULT false;

ALTER TABLE designs
ADD locked boolean DEFAULT false;

ALTER TABLE designs
ADD CONSTRAINT designs_pk
PRIMARY KEY (id);

CREATE TABLE IF NOT EXISTS designs_documents (
    id serial,
    path text NOT NULL,
    dsgnid integer,
    uploader integer,
    PRIMARY KEY(id),
    FOREIGN KEY(dsgnid) REFERENCES designs(id),
    FOREIGN KEY(uploader) REFERENCES users(id)
);

ALTER TABLE designs_documents
ADD active boolean DEFAULT true;

ALTER TABLE designs_documents
DROP CONSTRAINT designs_documents_dsgnid_fkey;

ALTER TABLE designs_documents
ADD FOREIGN KEY (dsgnid) REFERENCES designs
ON DELETE CASCADE;

--GRANT SELECT ON TABLE designs_documents TO app;

CREATE TABLE IF NOT EXISTS activity (
    id serial,
    design integer,
    session integer,
    FOREIGN KEY(design) REFERENCES designs(id),
    FOREIGN KEY(session) REFERENCES sessions(id)
);

/*
GRANT SELECT ON TABLE designs TO app;
GRANT ALL PRIVILEGES ON TABLE designs TO app;
GRANT USAGE, SELECT ON SEQUENCE designs_id_seq TO app;

GRANT SELECT ON TABLE activity TO app;
GRANT ALL PRIVILEGES ON TABLE activity TO app;
GRANT USAGE, SELECT ON SEQUENCE activity_id_seq TO app;
GRANT ALL PRIVILEGES ON TABLE designs_documents TO app;
GRANT USAGE, SELECT ON SEQUENCE designs_documents_id_seq TO app;
*/
