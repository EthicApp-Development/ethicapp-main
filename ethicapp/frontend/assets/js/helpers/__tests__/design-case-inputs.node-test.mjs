// The case inputs a design's services require (#1220), arranged for the
// design editor. The validator on the server decides; these helpers only
// arrange its answer per phase and service and name the analyses.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    caseAnalysisLabel,
    caseInputNoticesByPhase,
    caseInputsRequestKey,
    isMissingCaseInputsError,
} from "../design-case-inputs.js";

const REVIEWER = "essay-reviewer";

function phaseWith(enabledServiceIds, configurations = {}) {
    return { externalServices: { enabledServiceIds, configurations } };
}

describe("caseInputsRequestKey", () => {
    it("changes with the case and with each phase's services and settings", () => {
        const design = { caseId: 3, phases: [phaseWith([REVIEWER], { [REVIEWER]: { style: "a" } })] };
        const key = caseInputsRequestKey(design);

        assert.equal(typeof key, "string");
        assert.equal(caseInputsRequestKey(structuredClone(design)), key);
        assert.notEqual(caseInputsRequestKey({ ...design, caseId: 4 }), key);
        assert.notEqual(caseInputsRequestKey({
            ...design, phases: [phaseWith([REVIEWER], { [REVIEWER]: { style: "b" } })],
        }), key);
        assert.notEqual(caseInputsRequestKey({ ...design, phases: [{}, ...design.phases] }), key);
    });

    it("is null when no phase enables a service, or without a design", () => {
        assert.equal(caseInputsRequestKey(null), null);
        assert.equal(caseInputsRequestKey({ caseId: 3, phases: [] }), null);
        assert.equal(caseInputsRequestKey({ caseId: 3, phases: [{}, phaseWith([])] }), null);
    });
});

describe("caseAnalysisLabel", () => {
    const services = [
        { id: "glossary-maker", ui: { translations: { es_CL: { label: "Glosario" }, en_US: { label: "Glossary" } } } },
        { id: "summarizer", descriptor: { name: "Summary" } },
    ];

    it("names the analysis by its service's label in the UI language", () => {
        const input = { documentSchema: "glossary/v2", analysisServiceIds: ["glossary-maker"] };
        assert.equal(caseAnalysisLabel(input, services, "es_CL"), "Glosario");
        assert.equal(caseAnalysisLabel(input, services, "en_US"), "Glossary");
    });

    it("falls back to the descriptor's name, then to the document schema", () => {
        assert.equal(caseAnalysisLabel({ documentSchema: "summary/v1", analysisServiceIds: ["summarizer"] },
            services, "es_CL"), "Summary");
        assert.equal(caseAnalysisLabel({ documentSchema: "topics/v1", analysisServiceIds: ["unknown"] },
            services, "es_CL"), "topics/v1");
        assert.equal(caseAnalysisLabel({ documentSchema: "topics/v1" }, null, "es_CL"), "topics/v1");
    });
});

describe("caseInputNoticesByPhase", () => {
    it("arranges the validator's inputs per phase object and service", () => {
        const phases = [{}, {}];
        const inputs = [
            { phaseIndex: 1, serviceId: REVIEWER, key: "glossary", documentSchema: "glossary/v2", status: "pending" },
            { phaseIndex: 1, serviceId: REVIEWER, key: "summary", documentSchema: "summary/v1", status: "ready" },
            { phaseIndex: 0, serviceId: "other", key: "topics", documentSchema: "topics/v1", status: "absent" },
        ];

        const notices = caseInputNoticesByPhase(inputs, phases, input => `label of ${input.documentSchema}`);

        assert.deepEqual(notices.get(phases[1]), {
            [REVIEWER]: [
                { key:           "glossary", status:        "pending", ready:         false, analysisLabel: "label of glossary/v2",
                    messageKey:    "design_case_input_pending" },
                { key:           "summary", status:        "ready", ready:         true, analysisLabel: "label of summary/v1",
                    messageKey:    "design_case_input_ready" },
            ],
        });
        assert.deepEqual(notices.get(phases[0]).other.map(notice => notice.messageKey),
            ["design_case_input_absent"]);
    });

    it("leaves out unknown phases and statuses", () => {
        const phases = [{}];
        const notices = caseInputNoticesByPhase([
            { phaseIndex: 3, serviceId: REVIEWER, key: "a", status: "absent" },
            { phaseIndex: 0, serviceId: REVIEWER, key: "b", status: "exploded" },
        ], phases, () => "x");

        assert.equal(notices.size, 0);
        assert.equal(caseInputNoticesByPhase(null, phases, () => "x").size, 0);
    });
});

describe("isMissingCaseInputsError", () => {
    it("tells a phase start refused for a case analysis that is not ready", () => {
        assert.equal(isMissingCaseInputsError({ status: 422, data: { code: "MISSING_CASE_INPUTS" } }), true);
        assert.equal(isMissingCaseInputsError({ status: 422, data: { code: "INVALID_PHASE_DESIGN" } }), false);
        assert.equal(isMissingCaseInputsError({ status: 400, data: { code: "MISSING_CASE_INPUTS" } }), false);
        assert.equal(isMissingCaseInputsError(null), false);
    });
});
