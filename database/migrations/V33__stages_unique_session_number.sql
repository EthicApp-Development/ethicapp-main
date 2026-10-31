-- One phase per number in each activity (epic #892, sub-issue #906).
--
-- Design notes:
--
-- Starting a phase used to take several requests from the teacher's browser:
-- create the phase, add its items, form its groups, then move the activity to
-- it. A failure between them left a phase that was never started, and a
-- retry, a second tab or a second hold of the button created another phase
-- with the same number. Starting the next phase is now one transaction on the
-- server (ethicapp/backend/helpers/phase-start-helper.js), and this
-- constraint refuses a second phase with a number its session already has.
--
-- Phases that already share a session and a number are reduced to one before
-- the constraint is added. Of each set, the session's current phase is always
-- kept. The others are deleted, oldest first and while more than one is left,
-- with their items (differential, actors) and groups (teams, teamusers), but
-- only when nothing else refers to them:
-- - no response, chat message, role or other row with a foreign key to the
--   phase, its items or its groups (the deletion is attempted and rolled back
--   on a foreign key violation);
-- - no external service job or result (no foreign key, so checked here);
-- - no pending activity finalization.
-- So a phase kept when every other was deleted is the newest one, or the one
-- holding data. When two phases of a set both hold data, the migration stops
-- with an error and changes nothing; deploy/README.md ("Phase numbers")
-- explains how to find and resolve them.
--
-- A phase numbered above its session's current phase, and not a duplicate, is
-- left alone here. It was never started, and the next start of that phase
-- removes it.

DO $$
DECLARE
    candidate record;
BEGIN
    FOR candidate IN
        SELECT st.id, st.sesid, st.number
        FROM stages AS st
        INNER JOIN sessions AS s ON st.sesid = s.id
        WHERE st.id IS DISTINCT FROM s.current_stage
          AND EXISTS (
              SELECT 1
              FROM stages AS other
              WHERE other.sesid = st.sesid
                AND other.number = st.number
                AND other.id <> st.id
          )
        ORDER BY st.sesid, st.number, st.id
    LOOP
        -- Another phase with the same number is still there, and nothing
        -- without a foreign key refers to this one.
        CONTINUE WHEN NOT EXISTS (
            SELECT 1
            FROM stages AS other
            WHERE other.sesid = candidate.sesid
              AND other.number = candidate.number
              AND other.id <> candidate.id
        );
        CONTINUE WHEN EXISTS (
            SELECT 1 FROM external_service_jobs WHERE phase_id = candidate.id
        ) OR EXISTS (
            SELECT 1 FROM external_service_results WHERE phase_id = candidate.id
        ) OR EXISTS (
            SELECT 1 FROM activity_finalizations WHERE ended_phase_id = candidate.id
        );

        BEGIN
            DELETE FROM teamusers AS tu
            USING teams AS t
            WHERE tu.tmid = t.id
              AND t.stageid = candidate.id;
            DELETE FROM teams WHERE stageid = candidate.id;
            DELETE FROM differential WHERE stageid = candidate.id;
            DELETE FROM actors WHERE stageid = candidate.id;
            DELETE FROM stages WHERE id = candidate.id;
            RAISE NOTICE 'Deleted phase % (number %) of session %, a duplicate holding no data.',
                candidate.id, candidate.number, candidate.sesid;
        EXCEPTION WHEN foreign_key_violation THEN
            RAISE NOTICE 'Kept phase % (number %) of session %: other rows refer to it.',
                candidate.id, candidate.number, candidate.sesid;
        END;
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM stages
        WHERE sesid IS NOT NULL
        GROUP BY sesid, number
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Some sessions still have two phases with the same number, both holding data.'
            USING HINT = 'See "Phase numbers" in deploy/README.md to find and resolve them.';
    END IF;
END $$;

ALTER TABLE stages
ADD CONSTRAINT stages_sesid_number_key UNIQUE (sesid, number);
