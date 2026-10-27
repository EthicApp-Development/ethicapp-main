import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    CASE_ANALYSIS_COMPONENTS,
    canRegenerateCaseAnalysis,
    caseAnalysisChanged,
    caseAnalysisErrorKey,
    caseAnalysisIndicator,
    caseAnalysisState,
    caseAnalysisTabTitle,
    genericCaseAnalysisFields,
    hasLatestGenerationFailed,
    isCaseAnalysisInFlight,
    mergeCaseAnalysis,
    resolveCaseAnalysisComponent,
} from "../case-analyses.js";

const TRANSLATIONS = {
    es_CL: { label: "Análisis de prueba", description: "Cuenta.", tabTitle: "Prueba" },
    en_US: { label: "Mock case analysis", description: "Counts.", tabTitle: "Mock" },
};

function analysis(overrides = {}) {
    return {
        serviceId:    "mock-case-analysis",
        status:       "ready",
        stale:        false,
        errorCode:    null,
        errorMessage: null,
        updatedAt:    "2026-10-27T10:00:00.000Z",
        ui:           { component: "mock-case-analysis", translations: TRANSLATIONS },
        usable:       true,
        ...overrides,
    };
}

function withTranslations(translations) {
    return analysis({ ui: { component: null, translations } });
}

describe("resolveCaseAnalysisComponent", () => {
    it("returns the element name of an allowlisted component", () => {
        assert.equal(resolveCaseAnalysisComponent("mock-case-analysis"), "mock-case-analysis-view");
        assert.ok(Object.isFrozen(CASE_ANALYSIS_COMPONENTS));
    });

    it("returns null for missing, unknown and inherited names", () => {
        const names = [null, undefined, "", "evidence-inventory", "constructor", "__proto__", 42];
        for (const name of names) {
            assert.equal(resolveCaseAnalysisComponent(name), null, String(name));
        }
    });

    it("rejects allowlist entries that are not custom element names", () => {
        const components = { "a": "div", "b": "x-view onclick", "c": "case-view" };
        assert.equal(resolveCaseAnalysisComponent("a", components), null);
        assert.equal(resolveCaseAnalysisComponent("b", components), null);
        assert.equal(resolveCaseAnalysisComponent("c", components), "case-view");
    });
});

describe("caseAnalysisState", () => {
    it("maps statuses and staleness to the panel states", () => {
        assert.equal(caseAnalysisState(analysis({ status: "requested" })), "pending");
        assert.equal(caseAnalysisState(analysis({ status: "processing" })), "pending");
        assert.equal(caseAnalysisState(analysis({ status: "processing", stale: true })), "stuck");
        assert.equal(caseAnalysisState(analysis({ status: "requested", stale: true })), "stuck");
        assert.equal(caseAnalysisState(analysis({ status: "failed" })), "failed");
        assert.equal(caseAnalysisState(analysis()), "ready");
        assert.equal(caseAnalysisState(analysis({ status: "other" })), "unknown");
        assert.equal(caseAnalysisState(null), "unknown");
    });

    it("treats only fresh requested or processing generations as in flight", () => {
        assert.equal(isCaseAnalysisInFlight(analysis({ status: "requested" })), true);
        assert.equal(isCaseAnalysisInFlight(analysis({ status: "processing" })), true);
        const stale = analysis({ status: "processing", stale: true });
        assert.equal(isCaseAnalysisInFlight(stale), false);
        assert.equal(isCaseAnalysisInFlight(analysis()), false);
        assert.equal(isCaseAnalysisInFlight(analysis({ status: "failed" })), false);
    });

    it("flags a ready analysis whose latest generation failed", () => {
        assert.equal(hasLatestGenerationFailed(analysis({ errorCode: "timeout" })), true);
        assert.equal(hasLatestGenerationFailed(analysis()), false);
        const failed = analysis({ status: "failed", errorCode: "timeout" });
        assert.equal(hasLatestGenerationFailed(failed), false);
    });
});

describe("caseAnalysisIndicator", () => {
    it("gives each state a status key and an icon", () => {
        const cases = [
            [analysis({ status: "requested" }), "case_analysis_status_requested"],
            [analysis({ status: "processing" }), "case_analysis_status_processing"],
            [analysis({ status: "processing", stale: true }), "case_analysis_status_stuck"],
            [analysis({ status: "failed" }), "case_analysis_status_failed"],
            [analysis(), "case_analysis_status_ready"],
            [analysis({ errorCode: "adapter-error" }), "case_analysis_status_ready_with_error"],
            [analysis({ status: "other" }), "case_analysis_status_unknown"],
        ];

        for (const [item, statusKey] of cases) {
            const indicator = caseAnalysisIndicator(item);
            assert.equal(indicator.statusKey, statusKey);
            assert.match(indicator.iconClass, /^fa-solid fa-/);
        }
    });
});

describe("caseAnalysisErrorKey", () => {
    it("maps known error codes and falls back to a generic key", () => {
        assert.equal(
            caseAnalysisErrorKey("generation-not-started"),
            "case_analysis_error_generation_not_started"
        );
        assert.equal(caseAnalysisErrorKey("render-failed"), "case_analysis_error_render_failed");
        assert.equal(caseAnalysisErrorKey("something-else"), "case_analysis_error_generic");
        assert.equal(caseAnalysisErrorKey("toString"), "case_analysis_error_generic");
        assert.equal(caseAnalysisErrorKey(null), "case_analysis_error_generic");
    });
});

describe("caseAnalysisTabTitle", () => {
    it("uses the tab title in the UI language", () => {
        assert.equal(caseAnalysisTabTitle(analysis(), "es_CL"), "Prueba");
        assert.equal(caseAnalysisTabTitle(analysis(), "en_US"), "Mock");
    });

    it("falls back to the label, the other language and the service id", () => {
        const labelsOnly = {
            es_CL: { label: "Etiqueta", description: "x", tabTitle: null },
            en_US: { label: "Label", description: "x", tabTitle: null },
        };
        assert.equal(
            caseAnalysisTabTitle(withTranslations(labelsOnly), "es_CL"),
            "Etiqueta"
        );

        const englishOnly = { en_US: TRANSLATIONS.en_US };
        assert.equal(
            caseAnalysisTabTitle(withTranslations(englishOnly), "es_CL"),
            "Mock"
        );

        assert.equal(
            caseAnalysisTabTitle(withTranslations(null), "es_CL"),
            "mock-case-analysis"
        );
        assert.equal(caseAnalysisTabTitle({ serviceId: "case-analyst" }, "en_US"), "case-analyst");
    });
});

describe("canRegenerateCaseAnalysis", () => {
    it("offers a new generation for usable services without a fresh one in flight", () => {
        assert.equal(canRegenerateCaseAnalysis(analysis()), true);
        assert.equal(canRegenerateCaseAnalysis(analysis({ status: "failed" })), true);
        const stale = analysis({ status: "processing", stale: true });
        assert.equal(canRegenerateCaseAnalysis(stale), true);
        assert.equal(canRegenerateCaseAnalysis(analysis({ status: "processing" })), false);
        assert.equal(canRegenerateCaseAnalysis(analysis({ status: "requested" })), false);
        assert.equal(canRegenerateCaseAnalysis(analysis({ usable: false })), false);
    });
});

describe("mergeCaseAnalysis", () => {
    it("replaces the entry and keeps the listing's ui and usable, without the document", () => {
        const first = analysis();
        const second = { ...withTranslations(null), serviceId: "case-analyst" };
        const updated = {
            serviceId: "mock-case-analysis",
            status:    "requested",
            stale:     false,
            updatedAt: "2026-10-27T11:00:00.000Z",
            document:  { wordCount: 1 },
        };

        const merged = mergeCaseAnalysis([first, second], updated);

        assert.equal(merged[1], second);
        assert.equal(merged[0].status, "requested");
        assert.equal(merged[0].updatedAt, "2026-10-27T11:00:00.000Z");
        assert.deepEqual(merged[0].ui, first.ui);
        assert.equal(merged[0].usable, true);
        assert.equal(Object.hasOwn(merged[0], "document"), false);
    });

    it("ignores unknown services and invalid input", () => {
        const list = [analysis()];
        assert.deepEqual(mergeCaseAnalysis(list, { serviceId: "other", status: "ready" }), list);
        assert.equal(mergeCaseAnalysis(list, null), list);
        assert.deepEqual(mergeCaseAnalysis(null, analysis()), []);
    });
});

describe("caseAnalysisChanged", () => {
    it("asks for the detail when nothing is loaded or the listing reports another state", () => {
        const summary = analysis();
        assert.equal(caseAnalysisChanged(summary, null), true);
        assert.equal(caseAnalysisChanged(summary, { ...summary }), false);
        assert.equal(caseAnalysisChanged(summary, { ...summary, status: "processing" }), true);
        assert.equal(caseAnalysisChanged(summary, { ...summary, updatedAt: "earlier" }), true);
        assert.equal(caseAnalysisChanged(summary, { ...summary, stale: true }), true);
        assert.equal(caseAnalysisChanged(null, null), false);
    });
});

describe("genericCaseAnalysisFields", () => {
    it("lists the top-level fields of an object document", () => {
        assert.deepEqual(genericCaseAnalysisFields({
            wordCount: 12,
            excerpt:   "The case.",
            flags:     { reviewed: true },
            empty:     null,
        }), [
            { key: "wordCount", text: "12", structured: false },
            { key: "excerpt", text: "The case.", structured: false },
            { key: "flags", text: "{\n  \"reviewed\": true\n}", structured: true },
            { key: "empty", text: "", structured: false },
        ]);
    });

    it("shows other documents as one entry without key", () => {
        assert.deepEqual(genericCaseAnalysisFields(["a"]), [
            { key: null, text: "[\n  \"a\"\n]", structured: true },
        ]);
        assert.deepEqual(genericCaseAnalysisFields("text"), [
            { key: null, text: "text", structured: false },
        ]);
        assert.deepEqual(genericCaseAnalysisFields(null), []);
        assert.deepEqual(genericCaseAnalysisFields(undefined), []);
    });
});
