// Test adapter that keeps what the registry passes to register() and accepts
// every document it is asked to validate.

export const received = {};

export async function register({ caseAnalyses }) {
    received.caseAnalyses = caseAnalyses;
}

export function validateCaseAnalysisDocument(document) {
    return { document };
}
