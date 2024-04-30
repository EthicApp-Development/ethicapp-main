CREATE TABLE IF NOT EXISTS topics (
   topic_id serial,
   name text,
   PRIMARY KEY (topic_id)
);


CREATE TABLE IF NOT EXISTS cases (
   case_id serial,
   title text,
   external_case_url text NULL,
   description text,
   PRIMARY KEY (case_id)
);


CREATE TABLE IF NOT EXISTS cases_topics (
   case_topic_id serial,
   topic_id INT,
   case_id INT,
   PRIMARY KEY (case_topic_id),
   FOREIGN KEY (topic_id) REFERENCES topics(topic_id),
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


ALTER TABLE documents
ADD COLUMN case_id INTEGER REFERENCES cases(case_id);