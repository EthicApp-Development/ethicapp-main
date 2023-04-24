CREATE TABLE IF NOT EXISTS designs (
    id serial,
    creator integer,
    design jsonb,
    FOREIGN KEY (creator) REFERENCES users (id),
    public boolean DEFAULT false,
    locked boolean DEFAULT false
);

ALTER TABLE designs
ADD CONSTRAINT designs_pk
PRIMARY KEY (id);

CREATE TABLE IF NOT EXISTS designs_documents (
    id serial,
    path text NOT NULL,
    dsgnid integer,
    uploader integer,
    PRIMARY KEY (id),
    FOREIGN KEY (dsgnid) REFERENCES designs (id),
    FOREIGN KEY (uploader) REFERENCES users (id),
    active boolean DEFAULT true
);

ALTER TABLE designs_documents
DROP CONSTRAINT designs_documents_dsgnid_fkey; --?!

ALTER TABLE designs_documents
ADD FOREIGN KEY (dsgnid) REFERENCES designs
ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS activity (
    id serial,
    design integer,
    session integer,
    FOREIGN KEY (design) REFERENCES designs (id),
    FOREIGN KEY (session) REFERENCES sessions (id)
);
