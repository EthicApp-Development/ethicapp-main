CREATE TABLE IF NOT EXISTS report_activity (
    creation_date date,
    professor int,
    count int,
    PRIMARY KEY (creation_date, professor)
);

CREATE TABLE IF NOT EXISTS report_create_account (
    creation_date date,
    is_teacher bit,
    count int,
    PRIMARY KEY (creation_date, is_teacher)
);

CREATE TABLE IF NOT EXISTS report_login (
    login_date date,
    is_teacher bit,
    count int,
    PRIMARY KEY (login_date, is_teacher)
);

CREATE TABLE IF NOT EXISTS report_type (
    id serial,
    report_type text,
    report_description text,
    PRIMARY KEY (id)
);

CREATE OR REPLACE FUNCTION UpdateOrInsertLoginRecord(isProfessorPointer int) RETURNS void AS $$
DECLARE
currentDate date;
currentCount int;
BEGIN
currentDate := current_date; -- Get the current date

-- Check if a row with the current date exists
SELECT INTO currentCount count FROM report_login WHERE login_date = currentDate AND is_teacher = (isProfessorPointer::bit);

IF currentCount IS NULL THEN
    -- If no row exists, insert a new row with counter initialized to 1
    INSERT INTO report_login (login_date, is_teacher, count) VALUES (currentDate, isProfessorPointer::bit, 1);
ELSE
    -- If a row exists, increment the counter and update the row
    UPDATE report_login SET count = currentCount + 1 WHERE login_date = currentDate AND is_teacher = (isProfessorPointer::bit);
END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION UpdateOrInsertCreateAccountRecord(isProfessorPointer int)
RETURNS void AS $$
DECLARE
currentDate date;
currentCount int;
BEGIN
currentDate := current_date; -- Get the current date

-- Check if a row with the current date exists
SELECT INTO currentCount count FROM report_create_account WHERE creation_date = currentDate AND is_teacher= (isProfessorPointer::bit);

IF currentCount IS NULL THEN
    -- If no row exists, insert a new row with counter initialized to 1
    INSERT INTO report_create_account (creation_date, is_teacher, count) VALUES (currentDate, isProfessorPointer::bit, 1);
ELSE
    -- If a row exists, increment the counter and update the row
    UPDATE report_create_account SET count = currentCount + 1 WHERE creation_date = currentDate AND is_teacher = (isProfessorPointer::bit);
END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION UpdateOrInsertActivityRecord(professor_id int)
RETURNS void AS $$
DECLARE
    currentDate date;
    current_count int;
BEGIN
    currentDate := current_date; -- Get the current date

    -- Check if a row with the given professor_id and current_date exists
    SELECT INTO current_count count
    FROM report_activity
    WHERE creation_date = currentDate AND professor = professor_id;

    IF current_count IS NULL THEN
        -- If no row exists, insert a new row with counter initialized to 1
        INSERT INTO report_activity (creation_date, professor, count)
        VALUES (currentDate, professor_id, 1);
    ELSE
        -- If a row exists, increment the counter and update the row
        UPDATE report_activity
        SET count = current_count + 1
        WHERE creation_date = currentDate AND professor = professor_id;
    END IF;
END;
$$ LANGUAGE plpgsql;
