// Saving a design checks the case inputs its services require (#1220): POST
// /designs and PATCH /designs/:id refuse, with 400 MISSING_CASE_INPUTS, a
// design whose service configuration requires a case input that the case's
// analyses do not provide (absent, pending or failed), also when the save
// changes the design's case; a ready draft, reviewed or not, is enough.
// POST /designs/case-inputs gives the editor the same result without saving.
//
// The service is an imaginary essay reviewer, so no rule here is a real
// service's. PostgreSQL is a fake pg pool, and the registry's descriptor and
// policy reads are mocked.
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from "node:test";

import designsRouter, { OWN_DESIGN_CASE_SQL } from "../designs.js";
import { ASSOCIABLE_CASE_SQL } from "../../helpers/design-case-association.js";
import externalServicesRegistry from "../../services/external-services.service.js";
import { normalizeDescriptor } from "../../services/capability-descriptors.service.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const OWNER_ID = 7;
const DESIGN_ID = 12;
const CREATED_ID = 500;
const REVIEWER = "essay-reviewer";
const PRODUCER = "glossary-maker";

const CASE_READY = 31;
const CASE_DRAFT = 32;
const CASE_PENDING = 33;
const CASE_FAILED = 34;
const CASE_NONE = 35;
const CASE_FOREIGN = 36;

const ROWS_BY_CASE = new Map([
    [CASE_READY, {
        status:          "ready", document_schema: "glossary/v2", document:        { terms: ["T1"] },
        reviewed_at:     "2026-11-14T10:00:00Z", is_stale:        false,
    }],
    [CASE_DRAFT, {
        status:          "ready", document_schema: "glossary/v2", document:        { terms: ["T1"] },
        reviewed_at:     null, is_stale:        false,
    }],
    [CASE_PENDING, { status: "processing", document_schema: null, document: null, is_stale: false }],
    [CASE_FAILED, { status: "failed", document_schema: null, document: null, is_stale: false }],
]);

let storedCaseId = CASE_READY;
let written = [];

function rowsFor(sql, params = []) {
    if (sql === ASSOCIABLE_CASE_SQL) {
        return Number(params[0]) === CASE_FOREIGN ? [] : [{ id: Number(params[0]) }];
    }
    if (sql === OWN_DESIGN_CASE_SQL) {
        return Number(params[0]) === DESIGN_ID && Number(params[1]) === OWNER_ID
            ? [{ case_id: storedCaseId }]
            : [];
    }
    if (/FROM case_analyses\s+WHERE case_id = \$1\s+AND service_id = \$2/u.test(sql)) {
        const row = params[1] === PRODUCER ? ROWS_BY_CASE.get(Number(params[0])) : null;
        return row ? [{ case_id: Number(params[0]), service_id: PRODUCER, ...row }] : [];
    }
    if (/^\s*SELECT\b[\s\S]*\bFROM designs\b[\s\S]*WHERE id = \$1\b/u.test(sql)
        && Number(params[0]) === DESIGN_ID) {
        return [{
            id:               DESIGN_ID,
            creator:          OWNER_ID,
            locked:           false,
            design:           { metainfo: { title: "Design" }, phases: [] },
            visibility:       "private",
            license_code:     "CC-BY-4.0",
            attribution_text: null,
            language_code:    "en_US",
            case_id:          storedCaseId,
        }];
    }
    if (/^\s*UPDATE designs\s+SET design = \$1/u.test(sql)) {
        written.push({ caseId: params[1] });
        return [{ id: DESIGN_ID }];
    }
    if (/^\s*INSERT INTO designs\s*\(/u.test(sql)) {
        written.push({ caseId: params[2] });
        return [{ id: CREATED_ID }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

function reviewerConfiguration() {
    const result = normalizeDescriptor({
        contract_version:       "1",
        service:                { id: "essay-reviewer-api", name: "Essay reviewer", uses_llm: true },
        instance_configuration: {
            fields: [{
                key:        "review_style",
                type:       "enum",
                required:   false,
                default:    "strict",
                display:    { label: "Style" },
                validation: { enum: [{ value: "strict", label: "Strict" }, { value: "free", label: "Free" }] },
            }],
        },
        runtime_configuration: { fields: [] },
        session_inputs:        {
            glossary: {
                source:        { kind: "case_analysis", document_schema: "glossary/v2", pointer: "/terms" },
                required_when: [{ field: "review_style", in: ["strict"] }],
            },
        },
    }, "essay-reviewer-api");
    return { available: true, stale: false, ...result.descriptor };
}

after(() => db.restore());

beforeEach(() => {
    db.reset();
    written = [];
    storedCaseId = CASE_READY;
    mock.method(externalServicesRegistry, "initialize", async () => {});
    mock.method(externalServicesRegistry, "getCurrentPolicyVersion", async () => ({ id: 3 }));
    mock.method(externalServicesRegistry, "usableServiceIds", async ids => ids);
    mock.method(externalServicesRegistry, "getServiceInstanceConfiguration",
        async serviceId => (serviceId === REVIEWER ? reviewerConfiguration() : null));
    mock.method(externalServicesRegistry, "getCaseAnalysisProducerIds",
        documentSchema => (documentSchema === "glossary/v2" ? [PRODUCER] : []));
});

afterEach(() => mock.restoreAll());

function reviewerDesign(configuration = {}) {
    return {
        type:     "semantic_differential",
        metainfo: { title: "Design" },
        phases:   [
            { mode: "individual", prevPhasesResponse: [] },
            {
                mode:               "team",
                prevPhasesResponse: [],
                externalServices:   {
                    enabledServiceIds: [REVIEWER],
                    configurations:    { [REVIEWER]: configuration },
                },
            },
        ],
    };
}

function send(method, caseId, design = reviewerDesign()) {
    return requestRouter(designsRouter, {
        method,
        path:    method === "POST" ? "/designs" : `/designs/${DESIGN_ID}`,
        body:    { design, caseId, visibility: "private" },
        session: { uid: OWNER_ID, role: "P" },
    });
}

function caseAnalysisReads() {
    return db.queries.filter(query => /FROM case_analyses/u.test(query.sql));
}

for (const method of ["POST", "PATCH"]) {
    describe(`${method} ${method === "POST" ? "/designs" : "/designs/:id"} checks case inputs (#1220)`, () => {
        for (const [caseId, status] of [
            [CASE_NONE, "absent"],
            [CASE_PENDING, "pending"],
            [CASE_FAILED, "failed"],
            [null, "absent"],
        ]) {
            it(`refuses a required input whose analysis is ${status} (case ${caseId})`, async () => {
                const { status: httpStatus, body } = await send(method, caseId);

                assert.equal(httpStatus, 400);
                assert.equal(body.code, "MISSING_CASE_INPUTS");
                assert.deepEqual(body.errors, [{
                    phaseIndex:         1,
                    serviceId:          REVIEWER,
                    key:                "glossary",
                    documentSchema:     "glossary/v2",
                    analysisServiceIds: [PRODUCER],
                    status,
                }]);
                assert.match(body.message, /glossary\/v2 analysis/u);
                assert.deepEqual(written, []);
            });
        }

        for (const caseId of [CASE_READY, CASE_DRAFT]) {
            it(`saves with a ready analysis, reviewed or not (case ${caseId})`, async () => {
                const { status, body } = await send(method, caseId);

                assert.equal(status, 200, JSON.stringify(body));
                assert.deepEqual(written, [{ caseId }]);
                assert.deepEqual(body.caseInputs.map(input => [input.key, input.status]),
                    [["glossary", "ready"]]);
            });
        }

        it("saves a configuration that requires nothing without reading the case", async () => {
            const { status, body } = await send(method, CASE_NONE, reviewerDesign({ review_style: "free" }));

            assert.equal(status, 200, JSON.stringify(body));
            assert.deepEqual(body.caseInputs, []);
            assert.deepEqual(caseAnalysisReads(), []);
        });
    });
}

describe("PATCH /designs/:id when the case changes (#1220)", () => {
    it("refuses a new case without the analysis a stored configuration requires", async () => {
        storedCaseId = CASE_READY;

        const { status, body } = await send("PATCH", CASE_PENDING);

        assert.equal(status, 400);
        assert.equal(body.code, "MISSING_CASE_INPUTS");
        assert.deepEqual(written, []);
    });
});

describe("POST /designs/case-inputs (#1220)", () => {
    function check(body) {
        return requestRouter(designsRouter, {
            method:  "POST",
            path:    "/designs/case-inputs",
            body,
            session: { uid: OWNER_ID, role: "P" },
        });
    }

    it("answers what saving the design would find, without saving it", async () => {
        const { status, body } = await check({ design: reviewerDesign(), caseId: CASE_PENDING });

        assert.equal(status, 200);
        assert.equal(body.status, "ok");
        assert.deepEqual(body.result.missing.map(entry => [entry.phaseIndex, entry.key, entry.status]),
            [[1, "glossary", "pending"]]);
        assert.deepEqual(body.result.inputs, body.result.missing);
        assert.deepEqual(body.result.unchecked, []);
        assert.deepEqual(written, []);
    });

    it("keeps the case a design of the teacher already has", async () => {
        storedCaseId = CASE_FOREIGN;

        const { status, body } = await check({
            design: reviewerDesign(), caseId: CASE_FOREIGN, designId: DESIGN_ID,
        });

        assert.equal(status, 200);
        assert.equal(body.result.missing[0].status, "absent");
    });

    it("refuses a case the teacher may not associate", async () => {
        const { status, body } = await check({ design: reviewerDesign(), caseId: CASE_FOREIGN });

        assert.equal(status, 404);
        assert.equal(body.code, "CASE_NOT_AVAILABLE");
        assert.deepEqual(caseAnalysisReads(), []);
    });

    it("refuses a request without a design, and a student", async () => {
        assert.equal((await check({ caseId: CASE_READY })).status, 400);
        const student = await requestRouter(designsRouter, {
            method:  "POST",
            path:    "/designs/case-inputs",
            body:    { design: reviewerDesign(), caseId: CASE_READY },
            session: { uid: 30, role: "A" },
        });
        assert.notEqual(student.status, 200);
    });
});
