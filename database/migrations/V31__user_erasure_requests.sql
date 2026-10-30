-- Forgetting a student on demand (epic #879, sub-issue #876).
--
-- Design notes:
--
-- 1. Indexes on the columns the anonymization filters on. The per-account
-- step updates every row a student wrote, by user id, in four response
-- tables and in the AI service job and result tables. None of those columns
-- had an index, so each update scanned its whole table, once per student.
-- The external service tables keep many rows without a user (case, design
-- and group work), so their indexes are partial.
--
-- 2. user_erasure_requests: one row per account and AI Additions service
-- that must be asked to erase what it keeps about the account. The
-- management console writes the rows in the transaction that anonymizes the
-- account, both on demand and in the scheduled job; ethicapp, which holds
-- the AI Additions credentials, processes them in the background through the
-- `user-forgotten` hook and records the outcome here.
--
-- service_id is an AI Additions service id (`argumentation-tutor`,
-- `polyadic-agent`): the data lives in the service, whatever adapter sent
-- it. Ids are checked by format, so a later service needs no migration.
--
-- Status vocabulary:
--
--   pending: waiting for its next attempt at next_attempt_at. attempts > 0
--            means earlier attempts failed and it is being retried, with a
--            backoff that ethicapp computes from attempts.
--   done:    the service confirmed the erasure (completed_at is set).
--   failed:  the service refused the request in a way a retry cannot fix.
--            Only an administrator's retry sets it back to pending.
--
-- last_error is an upper-case code (UNREACHABLE, HTTP_503, ...), never a
-- message, so no free text can carry personal data.
--
-- user_id has no foreign key, like admin_audit_events (V27): an erasure
-- that AI Additions still owes must outlive any later change to the
-- account row.
--
-- 3. AI service payloads written after the account was anonymized. The
-- per-account step replaces the strings in the payloads of the account's
-- jobs and results, but an AI service can still deliver a callback for
-- work it received before: a later INSERT or UPDATE would store the
-- student's text again. Triggers on both tables replace the strings of the
-- new payload, as the step does, when the row's user is already anonymized,
-- with the placeholder of the run that anonymized it.
--
-- A write that races with the step is caught on one side or the other. The
-- step locks the account FOR UPDATE before it reads the payloads, and sets
-- anonymized_at after it, in one transaction.
--
--   INSERT: the trigger reads the account FOR SHARE, so it waits for a step
--           in progress and then sees anonymized_at; a row inserted before
--           the step locked the account is committed before the step reads
--           the payloads, which then include it.
--   UPDATE: the row is locked before the trigger runs, so the step's
--           SELECT ... FOR UPDATE of the payloads waits for the write and
--           replaces the strings of the version it committed. The trigger
--           reads the account without a lock, which could otherwise
--           deadlock with that SELECT, and catches every update after the
--           step committed.

CREATE INDEX IF NOT EXISTS idx_differential_selection_uid
ON differential_selection (uid);

CREATE INDEX IF NOT EXISTS idx_differential_chat_uid
ON differential_chat (uid);

CREATE INDEX IF NOT EXISTS idx_chat_uid
ON chat (uid);

CREATE INDEX IF NOT EXISTS idx_actor_selection_uid
ON actor_selection (uid);

CREATE INDEX IF NOT EXISTS idx_external_service_results_user_id
ON external_service_results (user_id)
WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_service_jobs_user_id
ON external_service_jobs (user_id)
WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_erasure_requests (
    id bigserial PRIMARY KEY,
    user_id integer NOT NULL,
    service_id varchar(64) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_attempt_at timestamptz,
    last_error varchar(64),
    requested_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    anonymization_run_id bigint
    REFERENCES student_anonymization_runs (id) ON DELETE SET NULL,
    CONSTRAINT user_erasure_requests_user_service_unique
    UNIQUE (user_id, service_id),
    CONSTRAINT user_erasure_requests_user_id_check
    CHECK (user_id > 0),
    CONSTRAINT user_erasure_requests_service_id_check
    CHECK (service_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
    CONSTRAINT user_erasure_requests_status_check
    CHECK (status IN ('pending', 'done', 'failed')),
    CONSTRAINT user_erasure_requests_attempts_check
    CHECK (attempts >= 0),
    CONSTRAINT user_erasure_requests_last_error_check
    CHECK (last_error IS NULL OR last_error ~ '^[A-Z][A-Z0-9_]*$'),
    CONSTRAINT user_erasure_requests_completed_check
    CHECK ((status = 'done') = (completed_at IS NOT NULL))
);

-- The processor's claim: the pending requests that are due.
CREATE INDEX IF NOT EXISTS idx_user_erasure_requests_due
ON user_erasure_requests (next_attempt_at)
WHERE status = 'pending';

-- A copy of a JSON value with every non-empty string replaced by the
-- placeholder, at any depth; keys, numbers, booleans and nulls are kept.
-- The same as redactJsonStrings in the management console.
CREATE OR REPLACE FUNCTION redact_jsonb_strings(value jsonb, placeholder text)
RETURNS jsonb AS $$
BEGIN
    CASE jsonb_typeof(value)
        WHEN 'string' THEN
            IF value = '""'::jsonb THEN
                RETURN value;
            END IF;
            RETURN to_jsonb(placeholder);
        WHEN 'array' THEN
            RETURN COALESCE(
                (
                    SELECT jsonb_agg(redact_jsonb_strings(item, placeholder) ORDER BY position)
                    FROM jsonb_array_elements(value) WITH ORDINALITY AS items (item, position)
                ),
                '[]'::jsonb
            );
        WHEN 'object' THEN
            RETURN COALESCE(
                (
                    SELECT jsonb_object_agg(key, redact_jsonb_strings(item, placeholder))
                    FROM jsonb_each(value) AS entries (key, item)
                ),
                '{}'::jsonb
            );
        ELSE
            RETURN value;
    END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- The placeholder for an anonymized user, or NULL when the user is not
-- anonymized. The run's placeholder, or the default of
-- student_anonymization_runs (V12) for an account anonymized without one.
CREATE OR REPLACE FUNCTION anonymized_user_placeholder(target_user_id integer, lock_account boolean)
RETURNS text AS $$
DECLARE
    anonymized timestamptz;
    run_id bigint;
BEGIN
    IF lock_account THEN
        SELECT anonymized_at, anonymization_run_id INTO anonymized, run_id
        FROM users
        WHERE id = target_user_id
        FOR SHARE;
    ELSE
        SELECT anonymized_at, anonymization_run_id INTO anonymized, run_id
        FROM users
        WHERE id = target_user_id;
    END IF;

    IF anonymized IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN COALESCE(
        (SELECT placeholder_text FROM student_anonymization_runs WHERE id = run_id),
        '******'
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION redact_external_service_result_of_anonymized_user()
RETURNS trigger AS $$
DECLARE
    placeholder text;
BEGIN
    placeholder := anonymized_user_placeholder(NEW.user_id, TG_OP = 'INSERT');

    IF placeholder IS NOT NULL THEN
        NEW.raw_payload := redact_jsonb_strings(NEW.raw_payload, placeholder);
        NEW.sanitized_payload := redact_jsonb_strings(NEW.sanitized_payload, placeholder);
        NEW.adapter_result := redact_jsonb_strings(NEW.adapter_result, placeholder);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION redact_external_service_job_of_anonymized_user()
RETURNS trigger AS $$
DECLARE
    placeholder text;
BEGIN
    placeholder := anonymized_user_placeholder(NEW.user_id, TG_OP = 'INSERT');

    IF placeholder IS NOT NULL THEN
        NEW.outbound_payload := redact_jsonb_strings(NEW.outbound_payload, placeholder);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS external_service_results_redact_anonymized_insert
ON external_service_results;
CREATE TRIGGER external_service_results_redact_anonymized_insert
BEFORE INSERT ON external_service_results
FOR EACH ROW
WHEN (new.user_id IS NOT NULL)
EXECUTE FUNCTION redact_external_service_result_of_anonymized_user();

DROP TRIGGER IF EXISTS external_service_results_redact_anonymized_update
ON external_service_results;
CREATE TRIGGER external_service_results_redact_anonymized_update
BEFORE UPDATE OF raw_payload, sanitized_payload, adapter_result
ON external_service_results
FOR EACH ROW
WHEN (new.user_id IS NOT NULL)
EXECUTE FUNCTION redact_external_service_result_of_anonymized_user();

-- No adapter sets outbound_payload today, so these never fire until one does.
DROP TRIGGER IF EXISTS external_service_jobs_redact_anonymized_insert
ON external_service_jobs;
CREATE TRIGGER external_service_jobs_redact_anonymized_insert
BEFORE INSERT ON external_service_jobs
FOR EACH ROW
WHEN (new.user_id IS NOT NULL AND new.outbound_payload IS NOT NULL)
EXECUTE FUNCTION redact_external_service_job_of_anonymized_user();

DROP TRIGGER IF EXISTS external_service_jobs_redact_anonymized_update
ON external_service_jobs;
CREATE TRIGGER external_service_jobs_redact_anonymized_update
BEFORE UPDATE OF outbound_payload ON external_service_jobs
FOR EACH ROW
WHEN (new.user_id IS NOT NULL AND new.outbound_payload IS NOT NULL)
EXECUTE FUNCTION redact_external_service_job_of_anonymized_user();
