// PATCH /cases/:id/sharing writes only a case's sharing fields (visibility,
// license and rights), whether or not a launched activity uses the case: the
// lock covers only its content and its deletion (#1014). It answers a teacher
// who does not own the case with the same 404 as for a missing one, and makes
// the public designs of a case made private private in the same transaction
// (#934). PostgreSQL is a fake pg pool that answers by matching the SQL, so
// nothing here needs a database.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import pg from "pg";

import casesRouter from "../cases.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const OWNER_ID = 7;
const OTHER_TEACHER_ID = 8;
const CASE_ID = 41;
const MISSING_CASE_ID = 999;
const DESIGN_TEACHER_ID = 9017;

const EXISTING_CASE = {
    id:                   CASE_ID,
    visibility:           "private",
    license_code:         "CC-BY-4.0",
    attribution_text:     "By Ada",
    rights_status:        "open_license",
    license_notes:        "Notes",
    permission_statement: null,
    commercial_source:    null,
};

const state = { inUse: false, publicDesignIds: [12], failDesigns: false, designCreators: [] };

const OWNERSHIP_SQL = /FROM ethical_cases\s+WHERE id = \$1\s+AND creator = \$2\s+FOR UPDATE/u;
const LAUNCHED_SQL = /INNER JOIN activity a ON a\.design = d\.id/u;
const COUNT_SQL = /SELECT COUNT\(\*\)::int AS count\s+FROM designs\s+WHERE case_id = \$1/u;

function isOwner(caseId, uid) {
    return Number(caseId) === CASE_ID && Number(uid) === OWNER_ID;
}

function rowsFor(sql, params) {
    if (OWNERSHIP_SQL.test(sql)) {
        return isOwner(params[0], params[1]) ? [{ ...EXISTING_CASE }] : [];
    }
    if (LAUNCHED_SQL.test(sql)) {
        return Number(params[0]) === CASE_ID && state.inUse ? [{ id: 3 }] : [];
    }
    if (/^\s*UPDATE ethical_cases\b/u.test(sql)) {
        const [
            visibility, licenseCode, attributionText, rightsStatus,
            licenseNotes, permissionStatement, commercialSource, caseId, uid,
        ] = params;
        return isOwner(caseId, uid)
            ? [{
                id:                   CASE_ID,
                visibility,
                license_code:         licenseCode,
                attribution_text:     attributionText,
                rights_status:        rightsStatus,
                license_notes:        licenseNotes,
                permission_statement: permissionStatement,
                commercial_source:    commercialSource,
            }]
            : [];
    }
    if (/^\s*UPDATE designs\b/u.test(sql)) {
        if (state.failDesigns) {
            throw new Error("designs update failed");
        }
        return Number(params[0]) === CASE_ID ? state.publicDesignIds.map(id => ({ id })) : [];
    }
    if (COUNT_SQL.test(sql)) {
        const count = Number(params[0]) === CASE_ID
            ? state.designCreators.filter(creator => creator !== Number(params[1])).length
            : 0;
        return [{ count }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

const connections = { taken: 0, released: 0 };
const fakeConnect = pg.Pool.prototype.connect;
pg.Pool.prototype.connect = async function connect() {
    const client = await fakeConnect.call(this);
    connections.taken += 1;
    return {
        ...client,
        release() {
            connections.released += 1;
        },
    };
};

after(() => db.restore());

beforeEach(() => {
    db.reset();
    state.inUse = false;
    state.publicDesignIds = [12];
    state.failDesigns = false;
    state.designCreators = [];
    connections.taken = 0;
    connections.released = 0;
});

const PUBLIC_SHARING = {
    visibility:          "public",
    licenseCode:         "CC-BY-SA-4.0",
    attributionText:     "By Grace",
    rightsStatus:        "used_with_permission",
    licenseNotes:        "New notes",
    permissionStatement: "Granted by the author",
    commercialSource:    "",
};

function changeSharing({ caseId = CASE_ID, uid = OWNER_ID, body = PUBLIC_SHARING } = {}) {
    return requestRouter(casesRouter, {
        method:  "PATCH",
        path:    `/cases/${caseId}/sharing`,
        body,
        session: { uid, role: "P" },
    });
}

function statements() {
    return db.queries.map(query => query.sql.trim());
}

function transactionEnd() {
    return statements().filter(sql => sql === "COMMIT" || sql === "ROLLBACK");
}

function caseUpdate() {
    return db.queries.find(query => /^\s*UPDATE ethical_cases\b/u.test(query.sql));
}

function designsUpdateIndex() {
    return statements().findIndex(sql => /^UPDATE designs\b/u.test(sql));
}

const CASE_NOT_FOUND = { status: "err", message: "Case not found.", code: "CASE_NOT_FOUND" };

describe("PATCH /cases/:id/sharing", () => {
    for (const inUse of [false, true]) {
        const label = inUse ? "a case in use" : "a case not in use";

        it(`writes the sharing fields of ${label} and answers like the switch`, async () => {
            state.inUse = inUse;
            state.publicDesignIds = [];
            state.designCreators = [DESIGN_TEACHER_ID];

            const { status, body } = await changeSharing();

            assert.equal(status, 200);
            assert.deepEqual(body.result, {
                id:                   CASE_ID,
                visibility:           "public",
                public:               true,
                licenseCode:          "CC-BY-SA-4.0",
                attributionText:      "By Grace",
                rightsStatus:         "used_with_permission",
                licenseNotes:         "New notes",
                permissionStatement:  "Granted by the author",
                commercialSource:     "",
                affectedDesignIds:    [],
                designsKeepingAccess: 1,
            });
            assert.deepEqual(caseUpdate().params, [
                "public", "CC-BY-SA-4.0", "By Grace", "used_with_permission",
                "New notes", "Granted by the author", "", CASE_ID, OWNER_ID,
            ]);
            assert.equal(statements().some(sql => LAUNCHED_SQL.test(sql)), false);
            assert.deepEqual(transactionEnd(), ["COMMIT"]);
            assert.equal(connections.released, connections.taken);
        });

        it(`makes ${label} private with its public designs, in one transaction`, async () => {
            state.inUse = inUse;
            state.publicDesignIds = [12, 13];

            const { status, body } = await changeSharing({
                body: { ...PUBLIC_SHARING, visibility: "private" },
            });

            assert.equal(status, 200);
            assert.equal(body.result.visibility, "private");
            assert.equal(body.result.public, false);
            assert.deepEqual(body.result.affectedDesignIds, [12, 13]);
            const sqls = statements();
            assert.ok(sqls.indexOf("BEGIN") < designsUpdateIndex());
            assert.ok(designsUpdateIndex() < sqls.indexOf("COMMIT"));
        });
    }

    it("writes nothing but the sharing fields", async () => {
        await changeSharing({
            body: { ...PUBLIC_SHARING, title: "Renamed", languageCode: "en_US" },
        });

        const { sql } = caseUpdate();
        assert.doesNotMatch(sql, /\btitle\b|\blanguage_code\b|\bpdf_path\b|\bauthor_/u);
        const touchedAuthorsOrTags = db.queries
            .some(query => /ethical_cases_(authors|tags)/u.test(query.sql));
        assert.equal(touchedAuthorsOrTags, false);
    });

    it("reads snake case fields as the case form does", async () => {
        const { status } = await changeSharing({
            body: { visibility: "public", license_code: "CC0-1.0", rights_status: "public_domain" },
        });

        assert.equal(status, 200);
        assert.deepEqual(caseUpdate().params.slice(0, 4), [
            "public", "CC0-1.0", "By Ada", "public_domain",
        ]);
    });

    it("keeps the case's values for absent or invalid fields", async () => {
        const { status, body } = await changeSharing({
            body: { visibility: "shared", licenseCode: " ", rightsStatus: "private_use_only" },
        });

        assert.equal(status, 200);
        assert.deepEqual(caseUpdate().params, [
            "private", "CC-BY-4.0", "By Ada", "open_license", "Notes", null, null,
            CASE_ID, OWNER_ID,
        ]);
        assert.equal(body.result.visibility, "private");
    });

    it("refuses sharing fields that are not text", async () => {
        const { status, body } = await changeSharing({
            body: { ...PUBLIC_SHARING, attributionText: { text: "By Grace" } },
        });

        assert.equal(status, 400);
        assert.equal(body.code, "CASE_VALIDATION_FAILED");
        assert.equal(db.queries.length, 0);
    });

    it("answers a teacher who does not own the case with 404, in use or not", async () => {
        const notInUse = await changeSharing({ uid: OTHER_TEACHER_ID });
        db.reset();
        state.inUse = true;
        const inUse = await changeSharing({ uid: OTHER_TEACHER_ID });

        assert.equal(notInUse.status, 404);
        assert.deepEqual(notInUse.body, CASE_NOT_FOUND);
        assert.deepEqual(inUse, notInUse);
        assert.equal(caseUpdate(), undefined);
        assert.equal(designsUpdateIndex(), -1);
        assert.equal(connections.released, connections.taken);
    });

    it("answers a missing case with the same 404", async () => {
        const missing = await changeSharing({ caseId: MISSING_CASE_ID });

        assert.equal(missing.status, 404);
        assert.deepEqual(missing.body, CASE_NOT_FOUND);
        assert.equal(caseUpdate(), undefined);
    });

    it("checks ownership inside the transaction, locking the case row", async () => {
        await changeSharing();

        const sqls = statements();
        const ownershipIndex = sqls.findIndex(sql => OWNERSHIP_SQL.test(sql));
        assert.ok(sqls.indexOf("BEGIN") < ownershipIndex);
        assert.deepEqual(db.queries[ownershipIndex].params, [CASE_ID, OWNER_ID]);
        assert.ok(ownershipIndex < sqls.findIndex(sql => /^UPDATE ethical_cases\b/u.test(sql)));
    });

    it("rolls the case back when the designs cannot be updated", async () => {
        state.failDesigns = true;
        const originalError = console.error;
        console.error = () => {};

        try {
            const { status } = await changeSharing({ body: { visibility: "private" } });
            assert.equal(status, 500);
        } finally {
            console.error = originalError;
        }

        assert.ok(caseUpdate());
        assert.deepEqual(transactionEnd(), ["ROLLBACK"]);
        assert.equal(connections.released, connections.taken);
    });

    it("answers 403 to a student", async () => {
        const { status } = await requestRouter(casesRouter, {
            method:  "PATCH",
            path:    `/cases/${CASE_ID}/sharing`,
            body:    PUBLIC_SHARING,
            session: { uid: OWNER_ID, role: "A" },
        });

        assert.equal(status, 403);
        assert.equal(caseUpdate(), undefined);
    });
});
