// Test adapter that provides UI translations.

export async function register() {}

export async function getUiTranslations() {
    return {
        es_CL: {
            label:       "Case tool (es_CL)",
            description: "Analyses the case (es_CL).",
            tabTitle:    "Analysis (es_CL)",
        },
        en_US: {
            label:       "Case tool",
            description: "Analyses the case.",
            tabTitle:    "Analysis",
        },
    };
}
