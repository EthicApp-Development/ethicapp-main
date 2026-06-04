let LanguageCatalogService = ($http, $translate) => {
    function normalizeUiLanguage(languageCode) {
        const normalized = String(languageCode || "").replace("-", "_");
        if (normalized === "es" || normalized.startsWith("es_")) {
            return "es_CL";
        }
        return "en_US";
    }

    const service = {
        languages: [],

        async getLanguages(reload = false) {
            if (reload || service.languages.length === 0) {
                const response = await $http.get("/languages");
                service.languages = Array.isArray(response.data.result) ? response.data.result : [];
            }
            return service.languages;
        },

        getCurrentUiLanguageCode() {
            return normalizeUiLanguage(
                $translate.use() ||
                $translate.proposedLanguage() ||
                $translate.preferredLanguage()
            );
        },

        getUiLanguageCodeForLocale(languageCode) {
            return normalizeUiLanguage(languageCode);
        },

        getDefaultLanguageCode(languages = service.languages, fallback = null) {
            const uiLanguageCode = service.getCurrentUiLanguageCode();
            const availableLanguages = Array.isArray(languages) ? languages : [];
            if (availableLanguages.some((language) => language.code === uiLanguageCode)) {
                return uiLanguageCode;
            }
            if (fallback && availableLanguages.some((language) => language.code === fallback)) {
                return fallback;
            }
            return availableLanguages[0]?.code || fallback || uiLanguageCode;
        },
    };

    return service;
};

export { LanguageCatalogService };
