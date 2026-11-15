// The validator of the case inputs a design's services require (#1220). The
// service is an imaginary essay reviewer whose descriptor declares a glossary
// from the case's analyses, required in its "strict" style (the default): the
// validator knows no real service, and every rule comes from the descriptor.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    checkCaseInputs,
    checkCaseInputsWithRegistry,
    MISSING_CASE_INPUTS_CODE,
    missingCaseInputsProblem,
    missingCaseInputsResponse,
} from "../case-input-validation.service.js";
import { normalizeDescriptor } from "../capability-descriptors.service.js";

const CASE_ID = 42;
const REVIEWER = "essay-reviewer";
const OTHER = "plain-service";

function reviewerDescriptor() {
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
    assert.equal(result.ok, true);
    return { available: true, ...result.descriptor };
}

const PLAIN_DESCRIPTOR = Object.freeze({
    available: true, fields: [], sessionInputs: [], sessionInputDeclarations: {},
});

function design(...phaseServices) {
    return {
        phases: phaseServices.map(services => ({
            externalServices: {
                enabledServiceIds: Object.keys(services),
                configurations:    services,
            },
        })),
    };
}

function readyGlossary() {
    return { status: "ready", document_schema: "glossary/v2", document: { terms: ["T1"] }, reviewed_at: null };
}

function makeCheck({ row = readyGlossary(), descriptors = {}, usable = null } = {}) {
    const descriptorReads = [];
    const analysisReads = [];
    const allDescriptors = { [REVIEWER]: reviewerDescriptor(), [OTHER]: PLAIN_DESCRIPTOR, ...descriptors };
    return {
        descriptorReads,
        analysisReads,
        check: options => checkCaseInputs({
            caseId:                   CASE_ID,
            usableServiceIds:         usable,
            getInstanceConfiguration: async (serviceId, locale) => {
                descriptorReads.push({ serviceId, locale });
                return allDescriptors[serviceId] ?? null;
            },
            deps: {
                producerServiceIds: documentSchema => (documentSchema === "glossary/v2" ? ["glossary-maker"] : []),
                getCaseAnalysis:    async ({ caseId, serviceId }) => {
                    analysisReads.push({ caseId, serviceId });
                    return row;
                },
            },
            ...options,
        }),
    };
}

describe("checkCaseInputs", () => {
    it("lists a required input the case provides as ready", async () => {
        const { check } = makeCheck();

        const result = await check({ design: design({ [REVIEWER]: {} }) });

        assert.deepEqual(result, {
            inputs: [{
                phaseIndex:         0,
                serviceId:          REVIEWER,
                key:                "glossary",
                documentSchema:     "glossary/v2",
                analysisServiceIds: ["glossary-maker"],
                status:             "ready",
            }],
            missing:   [],
            unchecked: [],
        });
    });

    it("reports a required input whose analysis is absent, pending or failed", async () => {
        for (const [row, status] of [
            [null, "absent"],
            [{ status: "processing", is_stale: false }, "pending"],
            [{ status: "failed" }, "failed"],
        ]) {
            const { check } = makeCheck({ row });
            const { missing } = await check({ design: design({ [OTHER]: {} }, { [REVIEWER]: { review_style: "strict" } }) });
            assert.deepEqual(missing.map(entry => [entry.phaseIndex, entry.serviceId, entry.key, entry.status]),
                [[1, REVIEWER, "glossary", status]]);
        }
    });

    it("requires nothing of a configuration whose conditions do not hold", async () => {
        const { check, analysisReads } = makeCheck({ row: null });
        const result = await check({ design: design({ [REVIEWER]: { review_style: "free" } }) });
        assert.deepEqual(result, { inputs: [], missing: [], unchecked: [] });
        assert.deepEqual(analysisReads, []);
    });

    it("ignores the configurations of services the phase does not enable", async () => {
        const { check } = makeCheck({ row: null });
        const disabled = {
            phases: [{
                externalServices: {
                    enabledServiceIds: [OTHER],
                    configurations:    { [REVIEWER]: { review_style: "strict" } },
                },
            }],
        };
        assert.deepEqual((await check({ design: disabled })).missing, []);
    });

    it("checks only the phases asked for", async () => {
        const { check } = makeCheck({ row: null });
        const twoPhases = design({ [REVIEWER]: {} }, { [REVIEWER]: { review_style: "free" } });

        assert.deepEqual((await check({ design: twoPhases, phaseIndexes: [1] })).missing, []);
        assert.equal((await check({ design: twoPhases, phaseIndexes: [0] })).missing.length, 1);
    });

    it("reads each descriptor and analysis once per check", async () => {
        const { check, descriptorReads, analysisReads } = makeCheck();
        await check({ design: design({ [REVIEWER]: {} }, { [REVIEWER]: {} }, { [REVIEWER]: {} }) });
        assert.deepEqual(descriptorReads, [{ serviceId: REVIEWER, locale: "en_US" }]);
        assert.deepEqual(analysisReads, [{ caseId: CASE_ID, serviceId: "glossary-maker" }]);
    });

    it("skips services that are not usable or whose descriptor cannot be read", async () => {
        const notAllowed = makeCheck({ row: null, usable: [OTHER] });
        assert.deepEqual(await notAllowed.check({ design: design({ [REVIEWER]: {} }) }), {
            inputs:    [],
            missing:   [],
            unchecked: [{ phaseIndex: 0, serviceId: REVIEWER, reason: "not_allowed" }],
        });
        assert.deepEqual(notAllowed.descriptorReads, []);

        const unreachable = makeCheck({
            row:         null,
            descriptors: { [REVIEWER]: { available: false, reason: "unreachable" } },
        });
        assert.deepEqual(await unreachable.check({ design: design({ [REVIEWER]: {} }) }), {
            inputs:    [],
            missing:   [],
            unchecked: [{ phaseIndex: 0, serviceId: REVIEWER, reason: "unreachable" }],
        });

        const undescribed = makeCheck({ row: null, descriptors: { [REVIEWER]: null } });
        assert.deepEqual(await undescribed.check({ design: design({ [REVIEWER]: {} }) }),
            { inputs: [], missing: [], unchecked: [] });
    });

    it("finds every required input absent without a case", async () => {
        const { check, analysisReads } = makeCheck();
        const { missing } = await check({ design: design({ [REVIEWER]: {} }), caseId: null });
        assert.equal(missing[0].status, "absent");
        assert.deepEqual(analysisReads, []);
    });

    it("needs no phases, services or descriptors", async () => {
        const { check, descriptorReads } = makeCheck();
        for (const empty of [{}, { phases: [] }, { phases: [{}] }, null]) {
            assert.deepEqual(await check({ design: empty }), { inputs: [], missing: [], unchecked: [] });
        }
        assert.deepEqual(descriptorReads, []);
    });
});

describe("checkCaseInputsWithRegistry", () => {
    function fakeRegistry() {
        const calls = [];
        return {
            calls,
            registry: {
                getCurrentPolicyVersion: async () => {
                    calls.push("current");
                    return { id: 3 };
                },
                usableServiceIds: async (ids, options) => {
                    calls.push(["usable", ids, options.policyVersion]);
                    return ids;
                },
                getServiceInstanceConfiguration: async (serviceId, locale, options) => {
                    calls.push(["descriptor", serviceId, options.policyVersion]);
                    return serviceId === REVIEWER ? reviewerDescriptor() : null;
                },
                getCaseAnalysisProducerIds: documentSchema => {
                    calls.push(["producers", documentSchema]);
                    return ["glossary-maker"];
                },
            },
        };
    }

    const getCaseAnalysis = async () => null;

    it("follows the current policy version by default", async () => {
        const { registry, calls } = fakeRegistry();
        const result = await checkCaseInputsWithRegistry({
            design: design({ [REVIEWER]: {} }), caseId: CASE_ID, registry, deps: { getCaseAnalysis },
        });
        assert.equal(result.missing[0].status, "absent");
        assert.deepEqual(calls.slice(0, 3), [
            "current",
            ["usable", [REVIEWER], { id: 3 }],
            ["descriptor", REVIEWER, { id: 3 }],
        ]);
        assert.ok(calls.some(call => call[0] === "producers" && call[1] === "glossary/v2"));
    });

    it("follows a given policy version, such as a session's, null included", async () => {
        const { registry, calls } = fakeRegistry();
        await checkCaseInputsWithRegistry({
            design:        design({ [REVIEWER]: {} }), caseId:        CASE_ID, registry, policyVersion: null,
            deps:          { getCaseAnalysis },
        });
        assert.equal(calls.includes("current"), false);
        assert.deepEqual(calls[0], ["usable", [REVIEWER], null]);
    });

    it("reads nothing for a design without services", async () => {
        const { registry, calls } = fakeRegistry();
        assert.deepEqual(
            await checkCaseInputsWithRegistry({ design: { phases: [{}] }, caseId: CASE_ID, registry }),
            { inputs: [], missing: [], unchecked: [] }
        );
        assert.deepEqual(calls, []);
    });
});

describe("answers", () => {
    const missing = [{
        phaseIndex:         1,
        serviceId:          REVIEWER,
        key:                "glossary",
        documentSchema:     "glossary/v2",
        analysisServiceIds: ["glossary-maker"],
        status:             "pending",
    }];

    it("refuses a save with 400 MISSING_CASE_INPUTS naming the analysis", () => {
        const warnings = [{ phaseIndex: 0, serviceId: OTHER, field: null, code: "not_allowed" }];
        const { status, body } = missingCaseInputsResponse({ missing }, warnings);

        assert.equal(status, 400);
        assert.equal(body.code, MISSING_CASE_INPUTS_CODE);
        assert.equal(body.code, "MISSING_CASE_INPUTS");
        assert.deepEqual(body.errors, missing);
        assert.deepEqual(body.warnings, warnings);
        assert.match(body.message, /phase 2, essay-reviewer: glossary needs the case's glossary\/v2 analysis \(pending\)/u);
    });

    it("explains why a phase cannot start", () => {
        assert.equal(missingCaseInputsProblem({ missing: [] }), null);
        assert.match(missingCaseInputsProblem({ missing }), /^The phase cannot start: phase 2/u);
    });
});
