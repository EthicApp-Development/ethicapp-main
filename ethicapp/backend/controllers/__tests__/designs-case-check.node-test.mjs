// The case a design points to is checked on create and update (#924, epic
// #923): only a case the teacher may pick in the editor's case search, their
// own or a public one that is not archived. Every other case gets the same
// 404 CASE_NOT_AVAILABLE, nothing is written, and one security warning is
// logged with ids only. PostgreSQL is a fake pg pool that answers the case
// lookup by applying the same rule to the cases below, so nothing here needs a
// database or the network.
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from "node:test";

import casesRouter from "../cases.js";
import designsRouter from "../designs.js";
import {
    ASSOCIABLE_CASE_SQL,
    CASE_NOT_AVAILABLE_CODE,
    DESIGN_CASE_REFUSED_EVENT,
    associableCaseSql,
} from "../../helpers/design-case-association.js";
import { UPDATE_UNLOCKED_DESIGN_SQL } from "../../helpers/design-update.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const TEACHER = Object.freeze({ uid: 7, role: "P" });
const OTHER_TEACHER_ID = 8;

const OWN_CASE = 41;
const PUBLIC_CASE = 42;
const OTHER_PRIVATE_CASE = 43;
const OWN_ARCHIVED_CASE = 44;
const PUBLIC_ARCHIVED_CASE = 45;
const OWN_UNLICENSED_CASE = 46;
const MISSING_CASE = 999;

const DESIGN_ID = 12;
// A design whose case was picked while it was public; its author has made
// it private since (PATCH /cases/:id/visibility keeps the association).
const STALE_DESIGN_ID = 13;
const NEW_DESIGN_ID = 500;

const cases = new Map([
    [OWN_CASE, { creator: TEACHER.uid, visibility: "private", license_code: "CC-BY-4.0" }],
    [PUBLIC_CASE, { creator: OTHER_TEACHER_ID, visibility: "public", license_code: "CC-BY-4.0" }],
    [OTHER_PRIVATE_CASE, {
        creator: OTHER_TEACHER_ID, visibility: "private", license_code: "CC-BY-4.0",
    }],
    [OWN_ARCHIVED_CASE, {
        creator: TEACHER.uid, visibility: "private", license_code: "CC-BY-4.0", archived: true,
    }],
    [PUBLIC_ARCHIVED_CASE, {
        creator: OTHER_TEACHER_ID, visibility: "public", license_code: "CC-BY-4.0", archived: true,
    }],
    [OWN_UNLICENSED_CASE, { creator: TEACHER.uid, visibility: "public", license_code: null }],
]);

const designs = new Map([
    [DESIGN_ID, { creator: TEACHER.uid, case_id: OWN_CASE, visibility: "private" }],
    [STALE_DESIGN_ID, {
        creator: TEACHER.uid, case_id: OTHER_PRIVATE_CASE, visibility: "private",
    }],
]);

// The rule of GET /cases/search, applied to the fixtures above.
function associableCaseRows(caseId, userId) {
    const row = cases.get(Number(caseId));
    const pickable = row
        && (row.creator === Number(userId) || row.visibility === "public")
        && row.archived !== true;
    return pickable ? [{ id: Number(caseId) }] : [];
}

function rowsFor(sql, params = []) {
    if (sql === ASSOCIABLE_CASE_SQL) {
        return associableCaseRows(params[0], params[1]);
    }
    if (/SELECT id, (creator, )?visibility, license_code\s+FROM ethical_cases\s+WHERE id = \$1/u
        .test(sql)) {
        const row = cases.get(Number(params[0]));
        return row ? [{ id: Number(params[0]), ...row }] : [];
    }
    if (/SELECT id, creator, locked, design, visibility/u.test(sql)) {
        const row = designs.get(Number(params[0]));
        return row ? [{
            id:               Number(params[0]),
            locked:           false,
            design:           JSON.stringify({ phases: [] }),
            license_code:     "CC-BY-4.0",
            attribution_text: null,
            language_code:    "en_US",
            ...row,
        }] : [];
    }
    if (/^\s*INSERT INTO designs\s*\(/u.test(sql)) {
        return [{ id: NEW_DESIGN_ID }];
    }
    if (sql === UPDATE_UNLOCKED_DESIGN_SQL) {
        return [{ id: params[2] }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);
let warn;

after(() => db.restore());

beforeEach(() => {
    db.reset();
    warn = mock.method(console, "warn", () => {});
});

afterEach(() => {
    warn.mock.restore();
});

const DESIGN = Object.freeze({ type: "semantic_differential", phases: [] });

function createDesign(body) {
    return requestRouter(designsRouter, {
        method:  "POST",
        path:    "/designs",
        body:    { design: DESIGN, ...body },
        session: TEACHER,
    });
}

function updateDesign(designId, body) {
    return requestRouter(designsRouter, {
        method:  "PATCH",
        path:    `/designs/${designId}`,
        body:    { design: { id: designId, ...DESIGN }, ...body },
        session: TEACHER,
    });
}

function securityWarnings() {
    return warn.mock.calls
        .map(call => call.arguments)
        .filter(([message]) => typeof message === "string" && message.startsWith("[security]"));
}

// The design writes of the request: the design row and its tags.
const DESIGN_WRITE = /^\s*(INSERT INTO designs|UPDATE designs|DELETE FROM designs_tags)/u;

function designWrites() {
    return db.queries.filter(query => DESIGN_WRITE.test(query.sql));
}

function caseLookups() {
    return db.queries.filter(query => query.sql === ASSOCIABLE_CASE_SQL);
}

function insertedCaseId() {
    const insert = db.queries.find(query => /^\s*INSERT INTO designs\s*\(/u.test(query.sql));
    return insert.params[2];
}

function updatedCaseId() {
    const update = db.queries.find(query => query.sql === UPDATE_UNLOCKED_DESIGN_SQL);
    return update.params[1];
}

function assertRefused({ status, body }, { designId = null, caseId }) {
    assert.equal(status, 404);
    assert.equal(body.status, "err");
    assert.equal(body.code, CASE_NOT_AVAILABLE_CODE);
    assert.deepEqual(designWrites(), [], "nothing is written");

    const warnings = securityWarnings();
    assert.equal(warnings.length, 1, "the refusal is logged once");
    assert.deepEqual(warnings[0][1], {
        event:  DESIGN_CASE_REFUSED_EVENT,
        userId: TEACHER.uid,
        designId,
        caseId,
    });
}

describe("POST /designs checks the case (#924)", () => {
    it("accepts the teacher's own case", async () => {
        const { status, body } = await createDesign({ caseId: OWN_CASE });

        assert.equal(status, 200, JSON.stringify(body));
        assert.equal(body.id, NEW_DESIGN_ID);
        assert.equal(insertedCaseId(), OWN_CASE);
        assert.deepEqual(caseLookups()[0].params, [OWN_CASE, TEACHER.uid]);
        assert.equal(securityWarnings().length, 0);
    });

    it("accepts another teacher's public case", async () => {
        const { status } = await createDesign({ caseId: String(PUBLIC_CASE) });

        assert.equal(status, 200);
        assert.equal(insertedCaseId(), PUBLIC_CASE, "stored as the parsed id");
        assert.equal(securityWarnings().length, 0);
    });

    it("accepts no case without looking one up", async () => {
        for (const caseId of [undefined, null, ""]) {
            db.reset();
            const { status } = await createDesign({ caseId });

            assert.equal(status, 200, String(caseId));
            assert.equal(insertedCaseId(), null);
            assert.equal(caseLookups().length, 0);
        }
        assert.equal(securityWarnings().length, 0);
    });

    it("refuses another teacher's private case", async () => {
        assertRefused(await createDesign({ caseId: OTHER_PRIVATE_CASE }),
            { caseId: OTHER_PRIVATE_CASE });
    });

    it("refuses a missing case the same way", async () => {
        assertRefused(await createDesign({ caseId: MISSING_CASE }), { caseId: MISSING_CASE });
    });

    it("refuses archived cases, the teacher's own and public ones", async () => {
        assertRefused(await createDesign({ caseId: OWN_ARCHIVED_CASE }),
            { caseId: OWN_ARCHIVED_CASE });

        db.reset();
        warn.mock.resetCalls();
        assertRefused(await createDesign({ caseId: PUBLIC_ARCHIVED_CASE }),
            { caseId: PUBLIC_ARCHIVED_CASE });
    });

    it("refuses a malformed case id, and logs no request text", async () => {
        for (const caseId of ["41; DROP TABLE designs", 0, -4, 1.5, { id: 41 }, [41], true]) {
            db.reset();
            warn.mock.resetCalls();

            assertRefused(await createDesign({ caseId }), { caseId: null });
            assert.equal(caseLookups().length, 0, JSON.stringify(caseId));
        }
    });

    it("checks the case for a public design before the public-design rules", async () => {
        assertRefused(await createDesign({ caseId: OTHER_PRIVATE_CASE, visibility: "public" }),
            { caseId: OTHER_PRIVATE_CASE });
    });

    it("keeps the public-design rules for the teacher's own cases", async () => {
        const privateCase = await createDesign({ caseId: OWN_CASE, visibility: "public" });
        assert.equal(privateCase.status, 409);
        assert.equal(privateCase.body.code, "CASE_VISIBILITY_REQUIRED");

        db.reset();
        const unlicensed = await createDesign({
            caseId:     OWN_UNLICENSED_CASE,
            visibility: "public",
        });
        assert.equal(unlicensed.status, 400);

        db.reset();
        const published = await createDesign({ caseId: PUBLIC_CASE, visibility: "public" });
        assert.equal(published.status, 200);
        assert.equal(insertedCaseId(), PUBLIC_CASE);
        assert.equal(securityWarnings().length, 0);
    });
});

describe("PATCH /designs/:id checks a new case (#924)", () => {
    it("accepts the teacher's own case and a public case", async () => {
        const own = await updateDesign(STALE_DESIGN_ID, { caseId: OWN_CASE });
        assert.equal(own.status, 200, JSON.stringify(own.body));
        assert.equal(updatedCaseId(), OWN_CASE);
        assert.deepEqual(caseLookups()[0].params, [OWN_CASE, TEACHER.uid]);

        db.reset();
        const shared = await updateDesign(DESIGN_ID, { caseId: PUBLIC_CASE });
        assert.equal(shared.status, 200);
        assert.equal(updatedCaseId(), PUBLIC_CASE);
        assert.deepEqual(caseLookups()[0].params, [PUBLIC_CASE, TEACHER.uid]);
        assert.equal(securityWarnings().length, 0);
    });

    it("accepts removing the case", async () => {
        const { status } = await updateDesign(STALE_DESIGN_ID, { caseId: null });

        assert.equal(status, 200);
        assert.equal(updatedCaseId(), null);
        assert.equal(caseLookups().length, 0);
    });

    it("refuses another teacher's private case, and logs the design", async () => {
        assertRefused(await updateDesign(DESIGN_ID, { caseId: OTHER_PRIVATE_CASE }),
            { designId: DESIGN_ID, caseId: OTHER_PRIVATE_CASE });
    });

    it("refuses missing and archived cases the same way", async () => {
        for (const caseId of [MISSING_CASE, OWN_ARCHIVED_CASE, PUBLIC_ARCHIVED_CASE]) {
            db.reset();
            warn.mock.resetCalls();

            assertRefused(await updateDesign(DESIGN_ID, { caseId }),
                { designId: DESIGN_ID, caseId });
        }
    });

    it("keeps an unchanged case the teacher could no longer pick", async () => {
        const { status } = await updateDesign(STALE_DESIGN_ID, {
            caseId: String(OTHER_PRIVATE_CASE),
        });

        assert.equal(status, 200);
        assert.equal(updatedCaseId(), OTHER_PRIVATE_CASE);
        assert.equal(caseLookups().length, 0, "the stored case is not looked up again");
        assert.equal(securityWarnings().length, 0);
    });

    it("checks the design's owner before the case", async () => {
        const { status } = await requestRouter(designsRouter, {
            method:  "PATCH",
            path:    `/designs/${DESIGN_ID}`,
            body:    { design: DESIGN, caseId: OTHER_PRIVATE_CASE },
            session: { uid: OTHER_TEACHER_ID, role: "P" },
        });

        assert.equal(status, 403);
        assert.equal(caseLookups().length, 0);
        assert.deepEqual(designWrites(), []);
        assert.equal(securityWarnings().length, 0);
    });
});

describe("GET /cases/search and the design check share one rule (#924)", () => {
    it("the case search lists the cases a design may point at", async () => {
        const { status } = await requestRouter(casesRouter, {
            path:    "/cases/search?q=case",
            session: TEACHER,
        });

        assert.equal(status, 200);
        const search = db.queries.find(query => /LIMIT 20/u.test(query.sql));
        assert.ok(search.sql.includes(associableCaseSql("c", "$2")));
        assert.equal(search.params[1], TEACHER.uid);
        assert.ok(ASSOCIABLE_CASE_SQL.includes(associableCaseSql("c", "$2")));
    });
});
