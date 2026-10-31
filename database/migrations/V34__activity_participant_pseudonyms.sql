-- Pseudonym numbers of an activity's participants (epic #892, sub-issue
-- #897).
--
-- Design notes:
--
-- The teacher's dashboard can hide the students' names, so that the teacher
-- can project it to the class. In a phase without groups, and in the list of
-- participants, a student is then shown as "Participante NN", with the number
-- stored here. Phases with groups show the letter each member already has in
-- teamusers.anon_mask instead, and need nothing new.
--
-- One number per student and activity, stable for the whole activity and
-- unique within it. ethicapp assigns it the first time the activity's owner
-- asks for the numbers (helpers/participant-pseudonyms-helper.js), drawn at
-- random among the free numbers of a range wider than the class, so numbers
-- follow neither the class list nor the join order. A student who joins late
-- gets a new number and nobody else's changes. Two concurrent assignments
-- (two dashboard tabs) insert with ON CONFLICT DO NOTHING: the primary key
-- keeps one number per student and the unique key one student per number,
-- and the loser of a collision draws again.
--
-- Only students (role A) who joined the session get a number; the teacher
-- does not. The rows are read only by the activity's owner.
--
-- Both foreign keys cascade. The number means nothing without its session or
-- its account, and the rows must not keep either from being deleted (a
-- session's participants in sesusers still do). Forgetting a student or a
-- teacher (#876, #877) leaves the rows as they are: a number is not personal
-- data, and a transferred activity keeps its numbers
-- (deploy/student-anonymization-data-map.md).
--
-- The primary key serves the lookups by session. There is no index on
-- user_id alone: only the deletion of an account, which is rare and is
-- refused while the account takes part in a session, looks rows up by it.

CREATE TABLE IF NOT EXISTS activity_participant_pseudonyms (
    session_id integer NOT NULL
    REFERENCES sessions (id) ON DELETE CASCADE,
    user_id integer NOT NULL
    REFERENCES users (id) ON DELETE CASCADE,
    number integer NOT NULL,
    CONSTRAINT activity_participant_pseudonyms_pkey
    PRIMARY KEY (session_id, user_id),
    CONSTRAINT activity_participant_pseudonyms_session_number_key
    UNIQUE (session_id, number),
    CONSTRAINT activity_participant_pseudonyms_number_check
    CHECK (number > 0)
);
