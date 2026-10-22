export function ExternalServicesCatalogService($http) {
    // One cached listing per requested set of scopes.
    const servicesByScopes = new Map();

    const service = {
        async loadServices(scopes = []) {
            const response = await $http.get("/external-services", { params: { scope: scopes } });
            if (response.data?.status === "ok" && Array.isArray(response.data.result)) {
                servicesByScopes.set(scopes.join(","), response.data.result);
                return response.data.result;
            }

            throw new Error("Unexpected external services response format.");
        },

        async getServices({ scopes = [], reload = false } = {}) {
            const cacheKey = scopes.join(",");
            if (reload || !servicesByScopes.has(cacheKey)) {
                return service.loadServices(scopes);
            }

            return servicesByScopes.get(cacheKey);
        },
    };

    return service;
}
