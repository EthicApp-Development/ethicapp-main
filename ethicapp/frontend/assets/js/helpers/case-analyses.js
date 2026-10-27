// Pure helpers for the case view tabs (#651, epic #647): one tab for the case
// text, then one per analysis chosen for the case (GET /cases/:id/analyses).

// AngularJS cannot load a component named by the manifest, so only the
// components listed here are compiled for an analysis tab: `ui.component` of
// the service's manifest entry → element name of a component registered in
// teacher-admin.mjs. Services whose component is missing or not listed get the
// generic panel.
export const CASE_ANALYSIS_COMPONENTS = Object.freeze({
    "mock-case-analysis":      "mock-case-analysis-view",
    // Case Analyst: case evaluation (#844).
    "case-evaluation":         "case-evaluation-view",
    // Case Analyst: evidence inventory (#652).
    "case-evidence-inventory": "case-evidence-inventory-view",
});

const ELEMENT_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

// How often the case view asks for the list while a generation is in flight.
export const CASE_ANALYSES_POLL_INTERVAL_MS = 5000;

const ERROR_KEYS = Object.freeze({
    "generation-not-started": "case_analysis_error_generation_not_started",
    "no-document":            "case_analysis_error_no_document",
    "render-failed":          "case_analysis_error_render_failed",
    "superseded":             "case_analysis_error_superseded",
    "timeout":                "case_analysis_error_timeout",
    "adapter-error":          "case_analysis_error_adapter_error",
    // Case Analyst adapters (#844): requests, results and the service's
    // public error codes.
    "empty-case-text":        "case_analysis_error_empty_case_text",
    "case-text-too-long":     "case_analysis_error_case_text_too_long",
    "request-failed":         "case_analysis_error_request_failed",
    "request-rejected":       "case_analysis_error_request_rejected",
    "invalid-result":         "case_analysis_error_invalid_result",
    "service-llm-error":      "case_analysis_error_service_llm_error",
    "service-llm-refusal":    "case_analysis_error_service_llm_refusal",
    "service-invalid-output": "case_analysis_error_service_invalid_output",
    "service-timeout":        "case_analysis_error_service_timeout",
    "service-worker-lost":    "case_analysis_error_service_worker_lost",
    "service-internal-error": "case_analysis_error_service_internal_error",
});

const INDICATORS = Object.freeze({
    "pending": {
        statusKey: "case_analysis_status_processing",
        iconClass: "fa-solid fa-circle-notch fa-spin text-info",
    },
    "requested": {
        statusKey: "case_analysis_status_requested",
        iconClass: "fa-solid fa-circle-notch fa-spin text-info",
    },
    "stuck": {
        statusKey: "case_analysis_status_stuck",
        iconClass: "fa-solid fa-triangle-exclamation text-warning",
    },
    "failed": {
        statusKey: "case_analysis_status_failed",
        iconClass: "fa-solid fa-circle-xmark text-danger",
    },
    "ready": {
        statusKey: "case_analysis_status_ready",
        iconClass: "fa-solid fa-circle-check text-success",
    },
    "ready-with-error": {
        statusKey: "case_analysis_status_ready_with_error",
        iconClass: "fa-solid fa-triangle-exclamation text-warning",
    },
    "unknown": {
        statusKey: "case_analysis_status_unknown",
        iconClass: "fa-solid fa-circle-question text-muted",
    },
});

/**
 * The element name of the component registered for `componentName`, or null
 * when it is not in the allowlist.
 */
export function resolveCaseAnalysisComponent(componentName, components = CASE_ANALYSIS_COMPONENTS) {
    if (typeof componentName !== "string" || !Object.hasOwn(components, componentName)) {
        return null;
    }

    const elementName = components[componentName];
    return typeof elementName === "string" && ELEMENT_NAME_PATTERN.test(elementName)
        ? elementName
        : null;
}

// A generation is in flight while it is requested or processing and not stale.
export function isCaseAnalysisInFlight(analysis) {
    return ["requested", "processing"].includes(analysis?.status) && analysis.stale !== true;
}

/**
 * What the tab shows: "pending" (a fresh generation is in flight), "stuck" (a
 * stale one), "failed", "ready" or "unknown".
 */
export function caseAnalysisState(analysis) {
    switch (analysis?.status) {
    case "requested":
    case "processing":
        return analysis.stale === true ? "stuck" : "pending";
    case "failed":
        return "failed";
    case "ready":
        return "ready";
    default:
        return "unknown";
    }
}

// A ready analysis whose latest generation failed keeps its previous document.
export function hasLatestGenerationFailed(analysis) {
    return analysis?.status === "ready" && Boolean(analysis.errorCode);
}

// The small status indicator of a tab: a translation key and an icon class.
export function caseAnalysisIndicator(analysis) {
    const state = caseAnalysisState(analysis);
    if (state === "pending" && analysis.status === "requested") {
        return INDICATORS.requested;
    }
    if (state === "ready" && hasLatestGenerationFailed(analysis)) {
        return INDICATORS["ready-with-error"];
    }
    return INDICATORS[state];
}

// The translation key that explains an analysis error code.
export function caseAnalysisErrorKey(errorCode) {
    return (typeof errorCode === "string" && Object.hasOwn(ERROR_KEYS, errorCode))
        ? ERROR_KEYS[errorCode]
        : "case_analysis_error_generic";
}

function textOf(translations, locale) {
    const texts = translations?.[locale];
    return texts?.tabTitle || texts?.label || null;
}

/**
 * The tab title: the adapter's `tabTitle` in the UI language, or its `label`,
 * then the same texts in the other UI language, then the service id.
 */
export function caseAnalysisTabTitle(analysis, uiLanguage) {
    const translations = analysis?.ui?.translations;
    const otherLanguage = uiLanguage === "es_CL" ? "en_US" : "es_CL";

    return textOf(translations, uiLanguage)
        || textOf(translations, otherLanguage)
        || analysis?.serviceId
        || "";
}

// Whether the generate action can be offered: the service is usable and no
// fresh generation is in flight (a stale one can be replaced).
export function canRegenerateCaseAnalysis(analysis) {
    return analysis?.usable === true && !isCaseAnalysisInFlight(analysis);
}

/**
 * Replaces the entry of `updated.serviceId` in `analyses` with `updated`,
 * keeping the `ui` and `usable` of the listing, which the single-analysis
 * endpoints do not return. Returns a new array; unknown services are ignored.
 */
export function mergeCaseAnalysis(analyses, updated) {
    if (!Array.isArray(analyses) || !updated?.serviceId) {
        return Array.isArray(analyses) ? analyses : [];
    }

    return analyses.map((analysis) => {
        if (analysis.serviceId !== updated.serviceId) {
            return analysis;
        }

        const summary = { ...updated, ui: analysis.ui, usable: analysis.usable };
        delete summary.document;
        return summary;
    });
}

// The detail must be read again when the listing reports another state.
export function caseAnalysisChanged(summary, loaded) {
    if (!summary) {
        return false;
    }
    if (!loaded) {
        return true;
    }
    return summary.status !== loaded.status
        || summary.updatedAt !== loaded.updatedAt
        || summary.stale !== loaded.stale;
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function displayValue(value) {
    if (value === null || value === undefined) {
        return { text: "", structured: false };
    }
    if (typeof value === "object") {
        return { text: JSON.stringify(value, null, 2), structured: true };
    }
    return { text: String(value), structured: false };
}

/**
 * The fields the generic panel shows for a document it has no view for:
 * one entry per top-level key of an object, or a single entry without key
 * for any other value. Nested values are shown as indented JSON.
 */
export function genericCaseAnalysisFields(document) {
    if (document === null || document === undefined) {
        return [];
    }

    if (!isPlainObject(document)) {
        return [{ key: null, ...displayValue(document) }];
    }

    return Object.entries(document).map(([key, value]) => ({ key, ...displayValue(value) }));
}
