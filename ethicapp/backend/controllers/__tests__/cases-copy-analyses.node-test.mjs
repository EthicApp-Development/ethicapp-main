// Case copies and case analyses (#1038): duplicating an own case and importing
// another teacher's public case copy the source's ready analyses inside the
// transaction that creates the copy, and request the other services the
// source chose after the answer, without letting that request fail the copy.
// PostgreSQL is a fake pg pool and the request is a fake, so nothing here
// needs a database or the network.
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from "node:test";

import casesRouter, { caseCopyServices } from "../cases.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const OWNER_ID = 7;
const IMPORTER_ID = 8;
const SOURCE_CASE_ID = 41;
const COPY_CASE_ID = 99;

const state = { sourceCreator: OWNER_ID };

const SOURCE_SQL = /SELECT id, title, author_firstname[\s\S]*FROM ethical_cases\s+WHERE id = \$1\s+AND creator (<>|=) \$2/u;

function rowsFor(sql, params) {
    const source = SOURCE_SQL.exec(sql);
    if (source) {
        const owner = Number(params[1]) === state.sourceCreator;
        const found = Number(params[0]) === SOURCE_CASE_ID && (source[1] === "=" ? owner : !owner);
        return found
            ? [{
                id:            SOURCE_CASE_ID,
                title:         "A case",
                creator:       state.sourceCreator,
                pdf_path:      null,
                visibility:    "public",
                license_code:  "CC-BY-4.0",
                language_code: "es",
            }]
            : [];
    }
    if (/SELECT nextval/u.test(sql)) {
        return [{ id: COPY_CASE_ID }];
    }
    if (/FROM ethical_cases c[\s\S]*WHERE c\.id = \$1/u.test(sql)) {
        return [{
            id:                COPY_CASE_ID,
            case_uuid:         "0f1e2d3c-0000-4000-8000-000000000099",
            title:             "A case (copia)",
            pdf_path:          null,
            visibility:        "private",
            language_code:     "es",
            pdf_render_job_id: null,
        }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);
const originalRequest = caseCopyServices.requestCopyAnalyses;
let requests = [];

after(() => db.restore());

beforeEach(() => {
    db.reset();
    requests = [];
    caseCopyServices.requestCopyAnalyses = async args => {
        requests.push(args);
        return [];
    };
});

afterEach(() => {
    caseCopyServices.requestCopyAnalyses = originalRequest;
});

const normalize = sql => sql.replace(/\s+/gu, " ").trim();

// The follow-up runs after the answer, on a later turn of the event loop.
async function settle(condition) {
    for (let attempt = 0; attempt < 20 && !condition(); attempt += 1) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

const ROUTES = [
    { name: "duplicate", sessionUid: OWNER_ID, sourceCreator: OWNER_ID },
    { name: "import", sessionUid: IMPORTER_ID, sourceCreator: OWNER_ID },
];

for (const route of ROUTES) {
    const copy = () => requestRouter(casesRouter, {
        method:  "POST",
        path:    `/cases/${SOURCE_CASE_ID}/${route.name}`,
        session: { uid: route.sessionUid, role: "P" },
    });

    describe(`POST /cases/:id/${route.name} and case analyses`, () => {
        beforeEach(() => {
            state.sourceCreator = route.sourceCreator;
        });

        it("copies the source's ready analyses inside the transaction", async () => {
            const { status, body } = await copy();

            assert.equal(status, 201);
            assert.equal(body.result.id, COPY_CASE_ID);

            const sqls = db.queries.map(query => normalize(query.sql));
            const copyIndex = sqls.findIndex(sql => sql.startsWith(
                "INSERT INTO case_analyses (case_id, service_id, status,"
            ));
            assert.notEqual(copyIndex, -1, "the analyses are copied");
            assert.deepEqual(db.queries[copyIndex].params, [SOURCE_CASE_ID, COPY_CASE_ID]);
            assert.match(sqls[copyIndex], /source\.status = 'ready'/u);

            const caseInsert = sqls.findIndex(sql => sql.startsWith("INSERT INTO ethical_cases ("));
            assert.ok(caseInsert < copyIndex, "after the copy exists");
            assert.ok(copyIndex < sqls.indexOf("COMMIT"), "in the same transaction");
        });

        it("requests the copy's other analyses after the answer, as the copying teacher", async () => {
            const { status } = await copy();
            assert.equal(status, 201);

            await settle(() => requests.length > 0);
            assert.equal(requests.length, 1);
            const [request] = requests;
            assert.equal(request.sourceCaseId, SOURCE_CASE_ID);
            assert.equal(request.copiedCase.id, COPY_CASE_ID);
            assert.equal(request.userId, route.sessionUid);
            assert.equal(request.pdfRenderJobId, null, "no PDF was copied, so no render was queued");
        });

        it("answers 201 when requesting the copy's analyses fails", async () => {
            caseCopyServices.requestCopyAnalyses = async args => {
                requests.push(args);
                throw new Error("follow-up failed");
            };
            const originalError = console.error;
            const logged = [];
            console.error = (...args) => { logged.push(args); };

            try {
                const { status, body } = await copy();
                assert.equal(status, 201);
                assert.equal(body.status, "ok");
                await settle(() => logged.length > 0);
            } finally {
                console.error = originalError;
            }

            assert.equal(requests.length, 1);
            assert.equal(logged.length, 1);
            assert.equal(logged[0][1].error.message, "follow-up failed");
        });

        it("copies and requests nothing when the source cannot be copied", async () => {
            // Duplicate needs the caller's case; import needs another teacher's.
            state.sourceCreator = route.name === "duplicate" ? IMPORTER_ID + 1 : route.sessionUid;

            const { status } = await copy();

            assert.ok(status === 403 || status === 404, `refused (${status})`);
            assert.ok(!db.queries.some(query => /INSERT INTO case_analyses/u.test(query.sql)));
            await settle(() => requests.length > 0);
            assert.equal(requests.length, 0);
        });
    });
}
