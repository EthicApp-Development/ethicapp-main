CREATE TABLE topic_tags (
   name text PRIMARY KEY

CREATE TABLE content_analysis (
    id SERIAL PRIMARY KEY,
    response_selections JSONB,
    context JSONB,
    sesid integer REFERENCES sessions(id),
    stage_id integer
);

ALTER TABLE sessions ADD COLUMN additional_config JSONB NULL;

CREATE TABLE IF NOT EXISTS topic_tags (
   topic_tag_id serial,
   name text,
   PRIMARY KEY (topic_tag_id)
);

CREATE TABLE IF NOT EXISTS cases (
    case_id serial PRIMARY KEY,
    title text,
    description text,
    rich_text text DEFAULT '',
    is_public BOOLEAN DEFAULT false,
    external_case_url text NULL,
    user_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);


-- Crear la función que actualizará la columna updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear el trigger que invoca la función anterior en cada UPDATE
CREATE TRIGGER update_updated_at_trigger
BEFORE UPDATE ON cases
FOR EACH ROW
EXECUTE PROCEDURE update_updated_at();


CREATE TABLE cases_topic_tags (
  
   topic_tag_name TEXT, 
CREATE TABLE IF NOT EXISTS cases_topic_tags (
   case_topic_id serial,
   topic_tag_id INT,
   case_id INT,
   PRIMARY KEY (case_id, topic_tag_name),
   FOREIGN KEY (topic_tag_name) REFERENCES topic_tags(name),
   FOREIGN KEY (case_id) REFERENCES cases(case_id)
);


CREATE TABLE IF NOT EXISTS cases_designs (
    case_design_id serial,
    case_id INT,
    design_id INT,
    PRIMARY KEY (case_design_id),
    FOREIGN KEY (design_id) REFERENCES designs (id),
    FOREIGN KEY (case_id) REFERENCES cases(case_id)
);

ALTER TABLE designs_documents
ADD COLUMN case_id INTEGER REFERENCES cases(case_id),
ADD COLUMN name TEXT;

ALTER TABLE designs
ADD COLUMN case_id INTEGER REFERENCES cases(case_id);
