CREATE TABLE IF NOT EXISTS topic_tags (
   topic_tag_id serial,
   name text,
   PRIMARY KEY (topic_tag_id)
);


CREATE TABLE IF NOT EXISTS cases (
   case_id serial,
   title text,
   description text,
   is_public BOOLEAN,
   external_case_url text NULL,
   user_id INT,
   PRIMARY KEY (case_id),
   FOREIGN KEY (user_id) REFERENCES users(id)
);


CREATE TABLE IF NOT EXISTS cases_topic_tags (
   case_topic_id serial,
   topic_tag_id INT,
   case_id INT,
   PRIMARY KEY (case_topic_id),
   FOREIGN KEY (topic_tag_id) REFERENCES topic_tags(topic_tag_id),
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