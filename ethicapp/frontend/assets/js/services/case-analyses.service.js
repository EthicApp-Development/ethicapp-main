// The teacher UI's client for the analyses chosen for a case (#649, #651).
// Only the case creator can read them: for any other case the API answers 404,
// which the listing treats as a case without analyses.

function analysesUrl(caseId) {
    return `/cases/${encodeURIComponent(caseId)}/analyses`;
}

function analysisUrl(caseId, serviceId) {
    return `${analysesUrl(caseId)}/${encodeURIComponent(serviceId)}`;
}

function resultOf(response, description) {
    if (response?.data?.status === "ok" && response.data.result !== undefined) {
        return response.data.result;
    }

    throw new Error(`Unexpected ${description} response format.`);
}

export function CaseAnalysesService($http) {
    return {
        // The chosen services with their status, `ui` and `usable`, without
        // documents. [] when the teacher cannot read the case's analyses.
        async listAnalyses(caseId) {
            try {
                const result = resultOf(await $http.get(analysesUrl(caseId)), "case analyses");
                return Array.isArray(result) ? result : [];
            } catch (error) {
                if (error?.status === 403 || error?.status === 404) {
                    return [];
                }
                throw error;
            }
        },

        // One analysis with its document.
        async getAnalysis(caseId, serviceId) {
            return resultOf(await $http.get(analysisUrl(caseId, serviceId)), "case analysis");
        },

        /**
         * Requests a new generation. Resolves with `{ outcome, analysis }`:
         * "accepted" with the reserved analysis, "busy" when a generation is
         * already in flight (409) or "disabled" when the service is not
         * usable (503). Other failures reject.
         */
        async generateAnalysis(caseId, serviceId) {
            try {
                const response = await $http.post(`${analysisUrl(caseId, serviceId)}/generate`);
                return { outcome: "accepted", analysis: resultOf(response, "case analysis") };
            } catch (error) {
                if (error?.status === 409) {
                    return { outcome: "busy", analysis: null };
                }
                if (error?.status === 503) {
                    return { outcome: "disabled", analysis: null };
                }
                throw error;
            }
        },

        // Stores a teacher edit, validated by the service's adapter. Rejects
        // with the HTTP response on 400 (`data.details`), 405 and 409.
        async saveAnalysis(caseId, serviceId, document) {
            const response = await $http.put(analysisUrl(caseId, serviceId), { document });
            return resultOf(response, "case analysis");
        },
    };
}
