CREATE TABLE IF NOT EXISTS teacher_account_requests (
    id serial,
    name text NOT NULL,
    rut text NULL,
    pass text NOT NULL,
    mail text NOT NULL,
    sex char(1),
    role char(1),
    institution text NOT NULL,
    date timestamp DEFAULT now(),
    status char(1) NOT NULL,
    reject_reason text NULL,
    PRIMARY KEY (id)
);
