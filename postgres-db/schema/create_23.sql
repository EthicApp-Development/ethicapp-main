CREATE TABLE pass_reset (
    id serial,
    mail varchar(32) NOT NULL,
    token varchar(64) NOT NULL,
    ctime timestamp,
    PRIMARY KEY (id)
);
