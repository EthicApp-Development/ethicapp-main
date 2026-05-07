export function ExternalServicesCatalogService($http) {
    const service = {
        services: [],
        hasLoadedServices: false,

        async loadServices() {
            const response = await $http.get("/external-services");
            if (response.data?.status === "ok" && Array.isArray(response.data.result)) {
                service.services = response.data.result;
                service.hasLoadedServices = true;
                return service.services;
            }

            throw new Error("Unexpected external services response format.");
        },

        async getServices(reload = false) {
            if (reload || !service.hasLoadedServices) {
                await service.loadServices();
            }

            return service.services;
        },
    };

    return service;
}
