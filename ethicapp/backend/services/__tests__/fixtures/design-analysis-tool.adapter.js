// Test adapter that keeps what the registry passes to register() and accepts
// every design analysis document it is asked to validate.

export const received = {};

export async function register({ caseAnalyses, designAnalyses }) {
    received.caseAnalyses   = caseAnalyses;
    received.designAnalyses = designAnalyses;
}

export function validateDesignAnalysisDocument(document) {
    return { document };
}
