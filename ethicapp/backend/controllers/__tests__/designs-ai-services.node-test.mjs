// GET /designs/:id/ai-services (#969) answers only for a design the teacher
// may launch, their own (POST /activities' rule), and gives another teacher's
// design, public or not, the same 404 as a missing one (#923, #929).
// PostgreSQL is a fake pg pool; the registry's policy reads are mocked, since
// the rules themselves are covered in
// helpers/__tests__/ai-service-launch-check.node-test.mjs.
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from "node:test";

import designsRouter from "../designs.js";
import { DESIGN_LAUNCH_SQL } from "../../helpers/activity-owner-helper.js";
import externalServicesRegistry from "../../services/external-services.service.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const TEACHER_ID = 7;
const OTHER_TEACHER_ID = 8;
const STUDENT_ID = 30;

const OWN_DESIGN_ID = 12;
const NO_SERVICES_DESIGN_ID = 13;
const PUBLIC_DESIGN_ID = 14;
const PRIVATE_DESIGN_ID = 15;
const MISSING_DESIGN_ID = 999;

const designs = new Map([
    [OWN_DESIGN_ID, {
        creator:    TEACHER_ID,
        visibility: "private",
        design:     {
            valid:  false,
            phases: [
                { externalServices: { enabledServiceIds: ["svc-running"] } },
                { externalServices: { enabledServiceIds: ["svc-running", "svc-stopped"] } },
            ],
        },
    }],
    [NO_SERVICES_DESIGN_ID, {
        creator:    TEACHER_ID,
        visibility: "private",
        design:     { valid: true, phases: [{}, {}] },
    }],
    [PUBLIC_DESIGN_ID, {
        creator:    OTHER_TEACHER_ID,
        visibility: "public",
        design:     { phases: [{ externalServices: { enabledServiceIds: ["svc-running"] } }] },
    }],
    [PRIVATE_DESIGN_ID, {
        creator:    OTHER_TEACHER_ID,
        visibility: "private",
        design:     { phases: [] },
    }],
]);

function rowsFor(sql, params = []) {
    const [designId, uid] = params.map(Number);
    const design = designs.get(designId);
    if (sql === DESIGN_LAUNCH_SQL) {
        return design ? [{ design_id: designId, owned: design.creator === uid }] : [];
    }
    if (/^\s*SELECT design\s+FROM designs\s+WHERE id = \$1\s*$/u.test(sql)) {
        return design ? [{ design: design.design }] : [];
    }
    return [];
}

const db = installFakePgPool(rowsFor);
const policyReads = [];

after(() => db.restore());

beforeEach(() => {
    db.reset();
    policyReads.length = 0;
    // The current version (3) allows svc-running only.
    mock.method(externalServicesRegistry, "initialize", async () => {});
    mock.method(externalServicesRegistry, "getCurrentPolicyVersion", async () => {
        policyReads.push("current");
        return { id: 3 };
    });
    mock.method(externalServicesRegistry, "getPolicyVersion", async (id) => {
        policyReads.push(`version:${id}`);
        return { id: 3 };
    });
    mock.method(externalServicesRegistry, "effectiveServiceIds", async (ids, version) => (
        version?.id === 3 ? ids.filter(id => id === "svc-running") : []
    ));
    mock.method(externalServicesRegistry, "getServiceUiTranslations", async () => null);
});

afterEach(() => mock.restoreAll());

function checkServices(designId, session = { uid: TEACHER_ID, role: "P" }) {
    return requestRouter(designsRouter, { path: `/designs/${designId}/ai-services`, session });
}

function launchQueries() {
    return db.queries.filter(query => query.sql === DESIGN_LAUNCH_SQL);
}

describe("GET /designs/:id/ai-services", () => {
    it("lists the services of the teacher's design, even an invalid one, by phase", async () => {
        const { status, body } = await checkServices(OWN_DESIGN_ID);

        assert.equal(status, 200);
        assert.deepEqual(body, {
            status:   "ok",
            services: [
                { phaseNumber: 1, serviceId: "svc-running", canRun: true },
                { phaseNumber: 2, serviceId: "svc-running", canRun: true },
                { phaseNumber: 2, serviceId: "svc-stopped", canRun: false },
            ],
        });
        assert.deepEqual(launchQueries()[0].params, [OWN_DESIGN_ID, TEACHER_ID]);
        assert.equal(policyReads[0], "current");
        assert.ok(policyReads.includes("version:3"));
    });

    it("answers an empty list for a design with no services", async () => {
        const { status, body } = await checkServices(NO_SERVICES_DESIGN_ID);

        assert.equal(status, 200);
        assert.deepEqual(body, { status: "ok", services: [] });
        assert.deepEqual(policyReads, []);
    });

    it("answers another teacher's design, public or private, as a missing one", async () => {
        const answers = await Promise.all([
            checkServices(PUBLIC_DESIGN_ID),
            checkServices(PRIVATE_DESIGN_ID),
            checkServices(MISSING_DESIGN_ID),
            checkServices("not-a-number"),
        ]);

        for (const answer of answers) {
            assert.equal(answer.status, 404);
            assert.deepEqual(answer, answers[0]);
        }
        assert.deepEqual(answers[0].body, { error: "Design not found." });
        assert.deepEqual(policyReads, []);
    });

    it("refuses a student (403) and no session (401) before any lookup", async () => {
        const student = await checkServices(OWN_DESIGN_ID, { uid: STUDENT_ID, role: "A" });
        const anonymous = await checkServices(OWN_DESIGN_ID, {});

        assert.equal(student.status, 403);
        assert.equal(anonymous.status, 401);
        assert.equal(launchQueries().length, 0);
    });
});
