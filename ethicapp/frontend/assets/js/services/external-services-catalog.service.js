// The design editor's client for the external services API. Every request
// carries the language the teacher UI is showing (`locale`, #745), so service
// names and descriptor labels match the rest of the screen.
export function ExternalServicesCatalogService($http, LanguageCatalogService) {
    // One cached listing per UI language and requested set of scopes.
    const servicesByKey = new Map();

    function currentLocale() {
        return LanguageCatalogService?.getCurrentUiLanguageCode?.() || "en_US";
    }

    function cacheKey(scopes, locale) {
        return `${locale}|${scopes.join(",")}`;
    }

    const service = {
        async loadServices(scopes = []) {
            const locale = currentLocale();
            const response = await $http.get("/external-services", {
                params: { scope: scopes, locale },
            });
            if (response.data?.status === "ok" && Array.isArray(response.data.result)) {
                servicesByKey.set(cacheKey(scopes, locale), response.data.result);
                return response.data.result;
            }

            throw new Error("Unexpected external services response format.");
        },

        async getServices({ scopes = [], reload = false } = {}) {
            const key = cacheKey(scopes, currentLocale());
            if (reload || !servicesByKey.has(key)) {
                return service.loadServices(scopes);
            }

            return servicesByKey.get(key);
        },

        // The instance configuration a service's capability descriptor
        // advertises (#728). `available: false` when the service cannot be
        // reached; the request rejects with 404 for services without one.
        async getInstanceConfiguration(serviceId) {
            const response = await $http.get(
                `/external-services/${encodeURIComponent(serviceId)}/instance-configuration`,
                { params: { locale: currentLocale() } }
            );
            if (response.data?.status === "ok" && response.data.result) {
                return response.data.result;
            }

            throw new Error("Unexpected instance configuration response format.");
        },
    };

    return service;
}
