let TagCatalogService = ($http, $translate) => {
    function getLocale() {
        return $translate.use() || "en_US";
    }

    const service = {
        async searchTags(query, scope) {
            const trimmedQuery = String(query || "").trim();
            if (trimmedQuery.length < 2) {
                return [];
            }

            const response = await $http.get("/tags/search", {
                params: {
                    q: trimmedQuery,
                    scope: scope || "case",
                    locale: getLocale(),
                },
            });

            return Array.isArray(response.data.result) ? response.data.result : [];
        },
    };

    return service;
};

export { TagCatalogService };
