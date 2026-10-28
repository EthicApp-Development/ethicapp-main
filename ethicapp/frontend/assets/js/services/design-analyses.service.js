// The teacher UI's client for the analyses of a design (epic #846). Only the
// design creator can read them: for any other design the API answers 404.

function analysisUrl(designId, serviceId) {
    return `/designs/${encodeURIComponent(designId)}/analyses/${encodeURIComponent(serviceId)}`;
}

function resultOf(response, description) {
    if (response?.data?.status === "ok" && response.data.result !== undefined) {
        return response.data.result;
    }

    throw new Error(`Unexpected ${description} response format.`);
}

// The 409 answers of POST .../generate, by their `code`.
const GENERATE_CONFLICTS = Object.freeze({
    DESIGN_LOCKED:                  "locked",
    DESIGN_ANALYSIS_PROCESSING:     "busy",
    DESIGN_ANALYSIS_NOT_APPLICABLE: "not-applicable",
    DESIGN_CHANGED:                 "changed",
});

export function DesignAnalysesService($http) {
    return {
        /**
         * One analysis with what the design view renders next to it (#865):
         * `{ analysis, units, unitsReason, producerUsable, tutorModes,
         * tutorPhases }` (`tutorPhases`, the mode each tutor phase requests,
         * since #870), where `analysis` (with its document) is null while the service has
         * produced nothing for the design. null when the service does not
         * analyse designs or the teacher cannot read the design's analyses.
         */
        async getAnalysis(designId, serviceId) {
            try {
                const response = await $http.get(analysisUrl(designId, serviceId));
                return resultOf(response, "design analysis");
            } catch (error) {
                if (error?.status === 403 || error?.status === 404) {
                    return null;
                }
                throw error;
            }
        },

        /**
         * Requests a new generation. Resolves with `{ outcome, analysis }`:
         * "accepted" with the reserved analysis; "locked", "busy",
         * "not-applicable" or "changed" for the 409 answers; "disabled" when
         * the service is not usable (503). Other failures reject.
         */
        async generateAnalysis(designId, serviceId) {
            try {
                const response = await $http.post(`${analysisUrl(designId, serviceId)}/generate`);
                return { outcome: "accepted", analysis: resultOf(response, "design analysis") };
            } catch (error) {
                if (error?.status === 409) {
                    const outcome = GENERATE_CONFLICTS[error.data?.code] ?? "busy";
                    return { outcome, analysis: null };
                }
                if (error?.status === 503) {
                    return { outcome: "disabled", analysis: null };
                }
                throw error;
            }
        },
    };
}
