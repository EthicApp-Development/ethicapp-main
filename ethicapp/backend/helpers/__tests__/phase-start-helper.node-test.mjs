// The transaction that starts an activity's next phase (#906), with a fake
// pg client that answers each statement by its SQL constant. What PostgreSQL
// itself decides (locks, constraints, the real rollback) is covered by
// phase-start.integration-test.mjs.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ACTIVITY_DESIGN_SQL,
    DELETE_LEFTOVER_PHASES_SQL,
    INSERT_PHASE_SQL,
    LEFTOVER_PHASES_SQL,
    LOCK_SESSION_SQL,
    LOCK_TEACHER_SQL,
    PHASE_NUMBER_SQL,
    createPhaseStarter,
    phaseColumns,
    phaseDesignProblem,
} from "../phase-start-helper.js";
import { INSERT_DIFFERENTIAL_ITEMS_SQL, INSERT_RANKING_ITEMS_SQL } from "../phase-items-helper.js";
import {
    INSERT_TEAM_MEMBERS_SQL,
    INSERT_TEAM_SQL,
    LATEST_TEAM_PHASE_SQL,
    PHASE_GROUP_MEMBERS_SQL,
    SESSION_STUDENTS_SQL,
} from "../groups-helper.js";
import { TRANSITION_SESSION_SQL } from "../teacher-activity-writes.js";

const TEACHER = 5;
const SESSION = 10;
const NEW_PHASE_ID = 501;

const NAMES = new Map([
    [LOCK_TEACHER_SQL, "LOCK_TEACHER"],
    [LOCK_SESSION_SQL, "LOCK_SESSION"],
    [PHASE_NUMBER_SQL, "PHASE_NUMBER"],
    [ACTIVITY_DESIGN_SQL, "ACTIVITY_DESIGN"],
    [LEFTOVER_PHASES_SQL, "LEFTOVER_PHASES"],
    [INSERT_PHASE_SQL, "INSERT_PHASE"],
    [INSERT_DIFFERENTIAL_ITEMS_SQL, "INSERT_DIFFERENTIAL_ITEMS"],
    [INSERT_RANKING_ITEMS_SQL, "INSERT_RANKING_ITEMS"],
    [SESSION_STUDENTS_SQL, "SESSION_STUDENTS"],
    [LATEST_TEAM_PHASE_SQL, "LATEST_TEAM_PHASE"],
    [PHASE_GROUP_MEMBERS_SQL, "PHASE_GROUP_MEMBERS"],
    [INSERT_TEAM_SQL, "INSERT_TEAM"],
    [INSERT_TEAM_MEMBERS_SQL, "INSERT_TEAM_MEMBERS"],
    [TRANSITION_SESSION_SQL, "TRANSITION_SESSION"],
    ...DELETE_LEFTOVER_PHASES_SQL.map((sql, index) => [sql, `DELETE_LEFTOVER_${index}`]),
]);

function question(text, overrides = {}) {
    return {
        q_text:     text,
        ans_format: {
            l_pole:          "Left",
            r_pole:          "Right",
            values:          7,
            just_required:   true,
            min_just_length: 5,
        },
        ...overrides,
    };
}

const SD_DESIGN = {
    type:   "semantic_differential",
    phases: [
        {
            mode:               "individual",
            anonymous:          true,
            chat:               false,
            grouping_algorithm: "random",
            stdntAmount:        3,
            prevPhasesResponse: [],
            questions:          [
                question("One"),
                question("**Two**", { q_text_content_type: "text/markdown" }),
            ],
        },
        {
            mode:               "team",
            anonymous:          false,
            chat:               true,
            grouping_algorithm: "random",
            stdntAmount:        2,
            prevPhasesResponse: [1],
            questions:          [question("Three")],
        },
        {
            mode:               "team",
            anonymous:          true,
            chat:               true,
            grouping_algorithm: "preserve",
            stdntAmount:        2,
            questions:          [question("Four")],
        },
    ],
};

const RANKING_DESIGN = {
    type:   "ranking",
    phases: [{
        mode:   "individual",
        q_text: "Rank them",
        roles:  [{ name: "First", type: "order", wc: 10 }, { name: "Second", type: null, wc: 0 }],
    }],
};

/**
 * A database for one request: the session's row, the current phase's number,
 * the design, and anything else the test needs. `failOn` makes one statement
 * throw.
 */
function makeDatabase({
    teacherActive = true,
    session = { id: SESSION, creator: TEACHER, status: 1, current_stage: null },
    currentPhaseNumber = null,
    design = SD_DESIGN,
    leftovers = [],
    students = [],
    previousTeamPhase = null,
    previousMembers = [],
    failOn = null,
} = {}) {
    const log = [];
    let nextTeamId = 900;
    const client = {
        released: false,
        async query(sql, params = []) {
            const name = NAMES.get(sql) ?? sql.trim();
            log.push({ name, params });
            if (name === failOn) {
                throw new Error(`Failed: ${name}`);
            }
            switch (name) {
            case "LOCK_TEACHER":
                return { rows: teacherActive ? [{ id: TEACHER }] : [] };
            case "LOCK_SESSION":
                return { rows: session ? [session] : [] };
            case "PHASE_NUMBER":
                return { rows: [{ number: currentPhaseNumber }] };
            case "ACTIVITY_DESIGN":
                return { rows: design ? [{ design }] : [] };
            case "LEFTOVER_PHASES":
                return { rows: leftovers.map(id => ({ id })) };
            case "INSERT_PHASE":
                return { rows: [{ id: NEW_PHASE_ID }] };
            case "SESSION_STUDENTS":
                return { rows: students.map(uid => ({ uid })) };
            case "LATEST_TEAM_PHASE":
                return { rows: previousTeamPhase ? [{ id: previousTeamPhase }] : [] };
            case "PHASE_GROUP_MEMBERS":
                return { rows: previousMembers };
            case "INSERT_TEAM":
                nextTeamId += 1;
                return { rows: [{ id: nextTeamId }] };
            case "TRANSITION_SESSION":
                return { rows: [{ id: SESSION }] };
            default:
                return { rows: [] };
            }
        },
        release() {
            client.released = true;
        },
    };
    return {
        client,
        log,
        names: () => log.map(entry => entry.name),
        find:  name => log.find(entry => entry.name === name),
    };
}

// The effects after commit, recorded in the same log as the statements.
function makeStarter(database, { random = () => 0, failing = {} } = {}) {
    const hooks = [];
    const errors = [];
    const starter = createPhaseStarter({
        connect:                     async () => database.client,
        invalidateStudentDescriptor: async (sessionId) => {
            database.log.push({ name: "INVALIDATE", params: [sessionId] });
            if (failing.invalidate) {
                throw new Error("cache down");
            }
        },
        notifyStudents: (sessionId) => {
            database.log.push({ name: "NOTIFY", params: [sessionId] });
            if (failing.notify) {
                throw new Error("socket down");
            }
        },
        dispatchPhaseHook: async (hookName, context) => {
            hooks.push({ hookName, context });
            if (failing.hooks) {
                throw new Error("service down");
            }
        },
        random,
        logger: { warn() {}, error: (...args) => errors.push(args) },
    });
    return { starter, hooks, errors };
}

const START = { sessionId: SESSION, teacherId: TEACHER, expectedPhaseNumber: 0 };

describe("starting the first phase", () => {
    it("creates the phase and its items from the stored design and moves the session", async () => {
        const database = makeDatabase();
        const { starter, hooks } = makeStarter(database);

        const result = await starter.startNextPhase(START);
        await result.hooks;

        assert.equal(result.status, "started");
        assert.deepEqual(result.phase, { id: NEW_PHASE_ID, number: 1 });
        assert.deepEqual(database.names(), [
            "BEGIN",
            "LOCK_TEACHER",
            "LOCK_SESSION",
            "ACTIVITY_DESIGN",
            "LEFTOVER_PHASES",
            "INSERT_PHASE",
            "INSERT_DIFFERENTIAL_ITEMS",
            "TRANSITION_SESSION",
            "COMMIT",
            "INVALIDATE",
            "NOTIFY",
        ]);
        assert.equal(database.client.released, true);

        assert.deepEqual(database.find("LOCK_TEACHER").params, [TEACHER]);
        assert.deepEqual(database.find("LOCK_SESSION").params, [SESSION]);
        assert.deepEqual(database.find("LEFTOVER_PHASES").params, [SESSION, 0]);
        assert.deepEqual(database.find("INSERT_PHASE").params,
            [1, "individual", true, false, SESSION, "[]", null, null]);
        assert.deepEqual(database.find("TRANSITION_SESSION").params,
            [2, NEW_PHASE_ID, SESSION, TEACHER]);

        const items = database.find("INSERT_DIFFERENTIAL_ITEMS").params;
        assert.deepEqual(items.slice(0, 8), [
            ["One", "**Two**"],
            [null, "text/markdown"],
            ["Left", "Left"],
            ["Right", "Right"],
            [1, 2],
            [7, 7],
            [true, true],
            [5, 5],
        ]);
        assert.deepEqual(items.slice(8), [TEACHER, NEW_PHASE_ID, SESSION]);

        // The first phase also starts the activity.
        const context = {
            sessionId:      SESSION,
            phaseId:        NEW_PHASE_ID,
            startedPhaseId: NEW_PHASE_ID,
            endedPhaseId:   null,
        };
        assert.deepEqual(hooks, [
            { hookName: "phase-started", context },
            { hookName: "activity-started", context },
        ]);
    });

    it("creates a ranking phase's roles", async () => {
        const database = makeDatabase({ design: RANKING_DESIGN });
        const { starter } = makeStarter(database);

        const result = await starter.startNextPhase(START);

        assert.equal(result.status, "started");
        assert.deepEqual(database.find("INSERT_PHASE").params,
            [1, "individual", false, false, SESSION, null, "Rank them", null]);
        assert.deepEqual(database.find("INSERT_RANKING_ITEMS").params, [
            ["First", "Second"],
            [true, false],
            [true, false],
            [10, 0],
            NEW_PHASE_ID,
        ]);
    });
});

describe("starting a team phase", () => {
    const AT_PHASE_ONE = {
        session:            { id: SESSION, creator: TEACHER, status: 2, current_stage: 401 },
        currentPhaseNumber: 1,
    };

    it("forms random groups of the design's size, with letters per group", async () => {
        const database = makeDatabase({ ...AT_PHASE_ONE, students: [41, 42, 43, 44, 45] });
        // Always 0: the shuffle moves each student to the front in turn.
        const { starter, hooks } = makeStarter(database, { random: () => 0 });

        const result = await starter.startNextPhase({ ...START, expectedPhaseNumber: 1 });
        await result.hooks;

        assert.deepEqual(result.phase, { id: NEW_PHASE_ID, number: 2 });
        assert.deepEqual(database.names(), [
            "BEGIN",
            "LOCK_TEACHER",
            "LOCK_SESSION",
            "PHASE_NUMBER",
            "ACTIVITY_DESIGN",
            "LEFTOVER_PHASES",
            "INSERT_PHASE",
            "INSERT_DIFFERENTIAL_ITEMS",
            "SESSION_STUDENTS",
            "INSERT_TEAM",
            "INSERT_TEAM",
            "INSERT_TEAM_MEMBERS",
            "TRANSITION_SESSION",
            "COMMIT",
            "INVALIDATE",
            "NOTIFY",
        ]);
        assert.deepEqual(database.find("PHASE_NUMBER").params, [401]);
        assert.deepEqual(database.find("INSERT_PHASE").params,
            [2, "team", false, true, SESSION, "[1]", null, "2:random"]);
        assert.deepEqual(database.find("INSERT_TEAM").params, [SESSION, NEW_PHASE_ID]);
        // [42, 43, 44, 45, 41] shuffled: groups [42, 43] and [44, 45], and 41
        // joins the first.
        assert.deepEqual(database.find("INSERT_TEAM_MEMBERS").params, [
            [901, 901, 901, 902, 902],
            [42, 43, 41, 44, 45],
            ["A", "B", "C", "A", "B"],
        ]);

        // Moving on from phase 1 does not start the activity again.
        assert.deepEqual(hooks.map(({ hookName, context }) => [hookName, context.phaseId]), [
            ["phase-ended", 401],
            ["phase-started", NEW_PHASE_ID],
        ]);
    });

    it("keeps the groups of the latest team phase, with letters in their order", async () => {
        const database = makeDatabase({
            session:            { id: SESSION, creator: TEACHER, status: 2, current_stage: 402 },
            currentPhaseNumber: 2,
            previousTeamPhase:  402,
            previousMembers:    [
                { team_id: 71, uid: 44 },
                { team_id: 71, uid: 45 },
                { team_id: 72, uid: 42 },
                { team_id: 72, uid: 43 },
                { team_id: 72, uid: 41 },
            ],
        });
        const { starter } = makeStarter(database);

        const result = await starter.startNextPhase({ ...START, expectedPhaseNumber: 2 });

        assert.deepEqual(result.phase, { id: NEW_PHASE_ID, number: 3 });
        assert.deepEqual(database.find("LATEST_TEAM_PHASE").params, [SESSION, 2]);
        assert.deepEqual(database.find("PHASE_GROUP_MEMBERS").params, [402]);
        assert.equal(database.names().includes("SESSION_STUDENTS"), false);
        assert.deepEqual(database.find("INSERT_TEAM_MEMBERS").params, [
            [901, 901, 902, 902, 902],
            [44, 45, 42, 43, 41],
            ["A", "B", "A", "B", "C"],
        ]);
    });

    it("creates no team when no student joined", async () => {
        const database = makeDatabase({ ...AT_PHASE_ONE, students: [] });
        const { starter } = makeStarter(database);

        const result = await starter.startNextPhase({ ...START, expectedPhaseNumber: 1 });

        assert.equal(result.status, "started");
        assert.equal(database.names().includes("INSERT_TEAM"), false);
        assert.equal(database.names().includes("INSERT_TEAM_MEMBERS"), false);
    });
});

describe("phases left by a start that failed before this transaction", () => {
    it("are removed with their items and groups before the phase is created", async () => {
        const database = makeDatabase({ leftovers: [301, 302] });
        const { starter } = makeStarter(database);

        const result = await starter.startNextPhase(START);

        assert.equal(result.status, "started");
        const names = database.names();
        const removal = names.slice(names.indexOf("LEFTOVER_PHASES") + 1,
            names.indexOf("INSERT_PHASE"));
        assert.deepEqual(removal,
            DELETE_LEFTOVER_PHASES_SQL.map((sql, index) => `DELETE_LEFTOVER_${index}`));
        for (const entry of database.log.filter(e => e.name.startsWith("DELETE_LEFTOVER_"))) {
            assert.deepEqual(entry.params, [[301, 302]]);
        }
    });
});

describe("refusals, which roll back and announce nothing", () => {
    async function refused(databaseOptions, request = START) {
        const database = makeDatabase(databaseOptions);
        const { starter, hooks } = makeStarter(database);
        const result = await starter.startNextPhase(request);
        const names = database.names();
        assert.equal(names.at(-1), "ROLLBACK");
        assert.equal(names.some(name => /^(INSERT|DELETE|TRANSITION)/u.test(name)), false);
        assert.equal(names.includes("INVALIDATE"), false);
        assert.equal(names.includes("NOTIFY"), false);
        assert.deepEqual(hooks, []);
        assert.equal(database.client.released, true);
        return { result, names };
    }

    it("refuses an anonymized teacher before locking the session", async () => {
        const { result, names } = await refused({ teacherActive: false });
        assert.deepEqual(result, { status: "forbidden" });
        assert.deepEqual(names, ["BEGIN", "LOCK_TEACHER", "ROLLBACK"]);
    });

    it("refuses a session that does not exist", async () => {
        const { result } = await refused({ session: null });
        assert.deepEqual(result, { status: "not_found" });
    });

    it("refuses another teacher's session", async () => {
        const { result } = await refused({
            session: { id: SESSION, creator: 6, status: 1, current_stage: null },
        });
        assert.deepEqual(result, { status: "forbidden" });
    });

    it("refuses a finished activity", async () => {
        const { result } = await refused({
            session: { id: SESSION, creator: TEACHER, status: 3, current_stage: null },
        });
        assert.deepEqual(result, { status: "finished" });
    });

    it("refuses when the activity is no longer at the expected phase", async () => {
        const { result } = await refused({
            session:            { id: SESSION, creator: TEACHER, status: 2, current_stage: 401 },
            currentPhaseNumber: 1,
        });
        assert.deepEqual(result, { status: "stale", currentPhaseNumber: 1 });
    });

    it("refuses a session without an activity", async () => {
        const { result } = await refused({ design: null });
        assert.deepEqual(result, { status: "not_launched" });
    });

    it("refuses when the design has no phase after the current one", async () => {
        const { result } = await refused({
            session:            { id: SESSION, creator: TEACHER, status: 2, current_stage: 403 },
            currentPhaseNumber: 3,
        }, { ...START, expectedPhaseNumber: 3 });
        assert.deepEqual(result, { status: "no_next_phase", currentPhaseNumber: 3 });
    });

    it("refuses a design phase that cannot be started", async () => {
        const design = {
            type:   "semantic_differential",
            phases: [{
                mode:               "team",
                grouping_algorithm: "alphabetical",
                stdntAmount:        3,
                questions:          [],
            }],
        };
        const { result } = await refused({ design });
        assert.deepEqual(result, {
            status:  "invalid_design",
            problem: "Unsupported grouping algorithm: alphabetical",
        });
    });
});

describe("failures", () => {
    it("after the items roll everything back and announce nothing", async () => {
        const database = makeDatabase({
            session:            { id: SESSION, creator: TEACHER, status: 2, current_stage: 401 },
            currentPhaseNumber: 1,
            students:           [41, 42],
            failOn:             "INSERT_TEAM_MEMBERS",
        });
        const { starter, hooks } = makeStarter(database);

        await assert.rejects(starter.startNextPhase({ ...START, expectedPhaseNumber: 1 }),
            /INSERT_TEAM_MEMBERS/u);

        const names = database.names();
        assert.ok(names.indexOf("INSERT_DIFFERENTIAL_ITEMS")
            < names.indexOf("INSERT_TEAM_MEMBERS"));
        assert.equal(names.at(-1), "ROLLBACK");
        assert.equal(names.includes("COMMIT"), false);
        assert.equal(names.includes("INVALIDATE"), false);
        assert.deepEqual(hooks, []);
        assert.equal(database.client.released, true);
    });

    it("after the commit are logged and never undo the phase", async () => {
        const database = makeDatabase();
        const { starter, hooks, errors } = makeStarter(database, {
            failing: { invalidate: true, notify: true, hooks: true },
        });

        const result = await starter.startNextPhase(START);
        await result.hooks;

        assert.equal(result.status, "started");
        assert.ok(database.names().indexOf("COMMIT") < database.names().indexOf("INVALIDATE"));
        assert.deepEqual(hooks.map(hook => hook.hookName), ["phase-started", "activity-started"]);
        assert.equal(errors.length, 4);
    });
});

describe("phaseColumns", () => {
    it("takes the phase's settings from the design, as the dashboard used to send them", () => {
        assert.deepEqual(phaseColumns(SD_DESIGN.phases[1]), {
            type:     "team",
            anon:     false,
            chat:     true,
            prevAns:  "[1]",
            question: null,
            grouping: "2:random",
        });
        assert.deepEqual(phaseColumns({ mode: "individual" }), {
            type:     "individual",
            anon:     false,
            chat:     false,
            prevAns:  null,
            question: null,
            grouping: null,
        });
    });
});

describe("phaseDesignProblem", () => {
    it("accepts the phases of both design types", () => {
        for (const phase of SD_DESIGN.phases) {
            assert.equal(phaseDesignProblem("semantic_differential", phase), null);
        }
        assert.equal(phaseDesignProblem("ranking", RANKING_DESIGN.phases[0]), null);
    });

    it("names what makes a phase impossible to start", () => {
        assert.equal(phaseDesignProblem("jigsaw", { mode: "individual" }),
            "Unsupported design type: jigsaw");
        assert.equal(phaseDesignProblem("ranking", undefined), "The design's phase has no mode.");
        assert.equal(phaseDesignProblem("ranking", { mode: "" }),
            "The design's phase has no mode.");
        const sizeless = { mode: "team", grouping_algorithm: "random", stdntAmount: 0 };
        assert.equal(phaseDesignProblem("ranking", sizeless),
            "The design's team phase has no valid group size.");
        assert.equal(phaseDesignProblem("ranking", { mode: "team", grouping_algorithm: null }),
            "Unsupported grouping algorithm: null");
    });
});
