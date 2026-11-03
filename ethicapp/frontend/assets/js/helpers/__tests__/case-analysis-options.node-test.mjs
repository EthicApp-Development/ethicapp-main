import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    caseAnalysisAddErrorKey,
    caseAnalysisSaveErrorKey,
    caseAnalysisServicesToAdd,
    caseAnalysisServiceDescription,
    caseAnalysisServiceIdsPayload,
    caseAnalysisServiceLabel,
    caseAnalysisServiceUsesLlm,
    hasMissingCaseAnalysisSelection,
    pruneCaseAnalysisSelection,
    selectedCaseAnalysisServiceIds,
} from "../case-analysis-options.js";

const MOCK_SERVICE = {
    id: "mock-case-analysis",
    ui: {
        translations: {
            es_CL: { label: "Análisis de prueba", description: "Cuenta las palabras." },
            en_US: { label: "Mock case analysis", description: "Counts the words." },
        },
    },
    descriptor: null,
};

describe("selectedCaseAnalysisServiceIds", () => {
    it("returns nothing while the switch is off, even with boxes checked", () => {
        const form = { analysisEnabled: false, analysisSelection: { "svc-a": true } };

        assert.deepEqual(selectedCaseAnalysisServiceIds(form), []);
        assert.deepEqual(selectedCaseAnalysisServiceIds(undefined), []);
    });

    it("returns the checked ids in the listed order", () => {
        const form = {
            analysisEnabled:   true,
            analysisSelection: { "svc-b": true, "svc-a": true, "svc-c": false },
        };
        const services = [{ id: "svc-a" }, { id: "svc-b" }, { id: "svc-c" }];

        assert.deepEqual(selectedCaseAnalysisServiceIds(form, services), ["svc-a", "svc-b"]);
        assert.deepEqual(selectedCaseAnalysisServiceIds(form), ["svc-b", "svc-a"]);
    });

    it("tolerates a missing selection", () => {
        assert.deepEqual(selectedCaseAnalysisServiceIds({ analysisEnabled: true }), []);
    });
});

describe("hasMissingCaseAnalysisSelection", () => {
    it("blocks the save only when the switch is on and nothing is chosen", () => {
        assert.equal(hasMissingCaseAnalysisSelection({ analysisEnabled: false }), false);
        assert.equal(hasMissingCaseAnalysisSelection({
            analysisEnabled: true, analysisSelection: {},
        }), true);
        assert.equal(hasMissingCaseAnalysisSelection({
            analysisEnabled: true, analysisSelection: { "svc-a": false },
        }), true);
        assert.equal(hasMissingCaseAnalysisSelection({
            analysisEnabled: true, analysisSelection: { "svc-a": true },
        }), false);
    });
});

describe("pruneCaseAnalysisSelection", () => {
    it("keeps only chosen services that are still offered", () => {
        const selection = { "svc-a": true, "svc-gone": true, "svc-b": false };

        assert.deepEqual(
            pruneCaseAnalysisSelection(selection, [{ id: "svc-a" }, { id: "svc-b" }]),
            { "svc-a": true }
        );
    });

    it("returns an empty selection without services or a selection", () => {
        assert.deepEqual(pruneCaseAnalysisSelection({ "svc-a": true }, []), {});
        assert.deepEqual(pruneCaseAnalysisSelection(undefined, null), {});
    });
});

describe("caseAnalysisServiceIdsPayload", () => {
    it("is null when nothing is chosen, so the case is created without analyses", () => {
        assert.equal(caseAnalysisServiceIdsPayload({ analysisEnabled: false }), null);
        assert.equal(caseAnalysisServiceIdsPayload({
            analysisEnabled: false, analysisSelection: { "svc-a": true },
        }), null);
        assert.equal(caseAnalysisServiceIdsPayload({
            analysisEnabled: true, analysisSelection: {},
        }), null);
    });

    it("is the JSON list of chosen ids", () => {
        assert.equal(caseAnalysisServiceIdsPayload({
            analysisEnabled:   true,
            analysisSelection: { "mock-case-analysis": true, "case-analyst": false },
        }), "[\"mock-case-analysis\"]");
    });
});

describe("service labels", () => {
    it("uses the translation of the UI language", () => {
        assert.equal(caseAnalysisServiceLabel(MOCK_SERVICE, "es_CL"), "Análisis de prueba");
        assert.equal(caseAnalysisServiceLabel(MOCK_SERVICE, "en_US"), "Mock case analysis");
        assert.equal(caseAnalysisServiceDescription(MOCK_SERVICE, "es_CL"), "Cuenta las palabras.");
        assert.equal(caseAnalysisServiceDescription(MOCK_SERVICE, "en_US"), "Counts the words.");
    });

    it("falls back to the descriptor name, then the id, without translations", () => {
        assert.equal(caseAnalysisServiceLabel({
            id: "svc-a", ui: { translations: null }, descriptor: { name: "Service A" },
        }, "es_CL"), "Service A");
        assert.equal(caseAnalysisServiceLabel({ id: "svc-a" }, "es_CL"), "svc-a");
        assert.equal(caseAnalysisServiceDescription({ id: "svc-a" }, "es_CL"), "");
    });

    it("reports LLM use only when the descriptor says so", () => {
        assert.equal(caseAnalysisServiceUsesLlm({ descriptor: { usesLlm: true } }), true);
        assert.equal(caseAnalysisServiceUsesLlm({ descriptor: { usesLlm: null } }), false);
        assert.equal(caseAnalysisServiceUsesLlm(MOCK_SERVICE), false);
    });
});

describe("caseAnalysisSaveErrorKey", () => {
    it("maps a refused analysis choice to its translation key", () => {
        assert.equal(
            caseAnalysisSaveErrorKey({ data: { code: "CASE_ANALYSIS_SERVICE_INVALID" } }),
            "case_analysis_save_invalid"
        );
    });

    it("ignores other errors", () => {
        assert.equal(caseAnalysisSaveErrorKey({ data: { code: "CASE_PDF_REQUIRED" } }), null);
        assert.equal(caseAnalysisSaveErrorKey({ data: { code: "toString" } }), null);
        assert.equal(caseAnalysisSaveErrorKey(undefined), null);
    });
});

describe("caseAnalysisServicesToAdd (#1039)", () => {
    const services = [
        MOCK_SERVICE,
        { id: "case-evaluation" },
        { id: "case-topic-listing" },
    ];

    it("offers the services the case has not chosen, in their order", () => {
        assert.deepEqual(
            caseAnalysisServicesToAdd(services, ["case-evaluation"]).map(service => service.id),
            ["mock-case-analysis", "case-topic-listing"]
        );
    });

    it("offers every service to a case without analyses, and none once all are chosen", () => {
        assert.deepEqual(caseAnalysisServicesToAdd(services, []), services);
        assert.deepEqual(caseAnalysisServicesToAdd(services, undefined), services);
        assert.deepEqual(caseAnalysisServicesToAdd(
            services,
            ["mock-case-analysis", "case-evaluation", "case-topic-listing"]
        ), []);
    });

    it("ignores a chosen service the policy no longer allows, and malformed input", () => {
        assert.deepEqual(
            caseAnalysisServicesToAdd([MOCK_SERVICE], ["switched-off"]).map(service => service.id),
            ["mock-case-analysis"]
        );
        assert.deepEqual(caseAnalysisServicesToAdd(null, []), []);
        assert.deepEqual(
            caseAnalysisServicesToAdd([null, { id: 3 }, MOCK_SERVICE], []),
            [MOCK_SERVICE]
        );
    });
});

describe("caseAnalysisAddErrorKey (#1039)", () => {
    it("explains a service that is no longer allowed, and any other failure", () => {
        assert.equal(
            caseAnalysisAddErrorKey({ data: { code: "CASE_ANALYSIS_SERVICE_INVALID" } }),
            "case_analysis_save_invalid"
        );
        assert.equal(caseAnalysisAddErrorKey({ status: 500 }), "case_analysis_add_failed");
        assert.equal(caseAnalysisAddErrorKey(new Error("offline")), "case_analysis_add_failed");
    });
});
