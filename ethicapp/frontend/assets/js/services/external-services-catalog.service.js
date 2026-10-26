// The teacher UI's client for the external services API. Every request
// carries the language the teacher UI is showing (`locale`, #745), so service
// names and descriptor labels match the rest of the screen.

// How long the read-only views reuse a service's instance configuration (#757).
const SHARED_CONFIGURATION_TTL_MS = 60 * 1000;

export function ExternalServicesCatalogService(
    $http,
    LanguageCatalogService,
    now = () => Date.now()
) {
    // One cached listing per UI language and requested set of scopes.
    const servicesByKey = new Map();
    // Listings being loaded, so concurrent callers share one request.
    const loadingByKey = new Map();
    // Instance configurations shared by read-only views: key → { promise, expiresAt }.
    const sharedConfigurations = new Map();

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
            if (!reload && servicesByKey.has(key)) {
                return servicesByKey.get(key);
            }
            if (!reload && loadingByKey.has(key)) {
                return loadingByKey.get(key);
            }

            const loading = service.loadServices(scopes)
                .finally(() => loadingByKey.delete(key));
            loadingByKey.set(key, loading);
            return loading;
        },

        // The instance configuration a service's capability descriptor
        // advertises (#728). `available: false` when the service cannot be
        // reached; the request rejects with 404 for services without one.
        // With `reuse`, read-only views share one request per service and UI
        // language for a minute (#757); the editor always asks again.
        async getInstanceConfiguration(serviceId, { reuse = false } = {}) {
            if (!reuse) {
                return service.loadInstanceConfiguration(serviceId);
            }

            const key = `${currentLocale()}|${serviceId}`;
            const shared = sharedConfigurations.get(key);
            if (shared && shared.expiresAt > now()) {
                return shared.promise;
            }

            const promise = service.loadInstanceConfiguration(serviceId);
            const expiresAt = now() + SHARED_CONFIGURATION_TTL_MS;
            sharedConfigurations.set(key, { promise, expiresAt });
            // A failed request is not shared: the next view asks again.
            promise.catch(() => sharedConfigurations.delete(key));
            return promise;
        },

        async loadInstanceConfiguration(serviceId) {
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
