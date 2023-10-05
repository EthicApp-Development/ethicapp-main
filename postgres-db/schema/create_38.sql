CREATE TABLE IF NOT EXISTS report_activity (
    creation_date DATE,
    professor INT,
    count INT,
    PRIMARY KEY (creation_date, professor)
);

CREATE TABLE IF NOT EXISTS report_create_account (
    creation_date DATE,
    isProfessor BIT,
    count INT,
    PRIMARY KEY (creation_date)
);

CREATE TABLE IF NOT EXISTS report_login (
    login_date DATE,
    isProfessor BIT,
    count INT,
    PRIMARY KEY (login_date)
);

CREATE TABLE IF NOT EXISTS report_type (
    id serial,
    report_type text,
    report_description text,
    PRIMARY KEY (id)
);

CREATE OR REPLACE FUNCTION UpdateOrInsertLoginRecord(isProfessorPointer INT) RETURNS VOID AS $$
DECLARE
currentDate DATE;
currentCount INT;
BEGIN
currentDate := current_date; -- Get the current date

-- Check if a row with the current date exists
SELECT INTO currentCount count FROM report_login WHERE login_date = currentDate AND isProfessor= isProfessorPointer ;

IF currentCount IS NULL THEN
    -- If no row exists, insert a new row with counter initialized to 1
    INSERT INTO report_login (login_date, isProfessor, count) VALUES (currentDate, isProfessorPointer, 1);
ELSE
    -- If a row exists, increment the counter and update the row
    UPDATE report_login SET count = currentCount + 1 WHERE login_date = currentDate;
END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION UpdateOrInsertCreateAccountRecord(isProfessorPointer INT) RETURNS VOID AS $$
DECLARE
currentDate DATE;
currentCount INT;
BEGIN
currentDate := current_date; -- Get the current date

-- Check if a row with the current date exists
SELECT INTO currentCount count FROM report_create_account WHERE creation_date = currentDate AND isProfessor= isProfessorPointer;

IF currentCount IS NULL THEN
    -- If no row exists, insert a new row with counter initialized to 1
    INSERT INTO report_create_account (creation_date, isProfessor, count) VALUES (currentDate, isProfessorPointer, 1);
ELSE
    -- If a row exists, increment the counter and update the row
    UPDATE report_create_account SET count = currentCount + 1 WHERE creation_date = currentDate;
END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION UpdateOrInsertActivityRecord(professor_id INT)
RETURNS VOID AS $$
DECLARE
    current_date DATE;
    current_count INT;
BEGIN
    current_date := current_date; -- Get the current date

    -- Check if a row with the given professor_id and current_date exists
    SELECT INTO current_count count
    FROM report_activity
    WHERE creation_date = current_date AND professor = professor_id;

    IF current_count IS NULL THEN
        -- If no row exists, insert a new row with counter initialized to 1
        INSERT INTO report_activity (creation_date, professor, count)
        VALUES (current_date, professor_id, 1);
    ELSE
        -- If a row exists, increment the counter and update the row
        UPDATE report_activity
        SET count = current_count + 1
        WHERE creation_date = current_date AND professor = professor_id;
    END IF;
END;
$$ LANGUAGE plpgsql;