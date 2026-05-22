let CasesCatalogService = ($http) => {
    function appendCaseSharingFields(formData, caseData) {
        formData.append("authors", JSON.stringify(caseData.authors || []));
        formData.append("visibility", caseData.visibility || "private");
        formData.append("license_code", caseData.licenseCode || "CC-BY-NC-SA-4.0");
        formData.append("rights_status", caseData.rightsStatus || "own_work");
        formData.append("language_code", caseData.languageCode || "es_CL");
        formData.append("can_be_shared_publicly", caseData.canBeSharedPublicly === true ? "true" : "false");
        formData.append("can_be_copied_by_others", caseData.canBeCopiedByOthers === true ? "true" : "false");
        formData.append("attribution_text", caseData.attributionText || "");
        formData.append("license_notes", caseData.licenseNotes || "");
        formData.append("permission_statement", caseData.permissionStatement || "");
        formData.append("commercial_source", caseData.commercialSource || "");
    }

    const service = {
        cases: [],
        publicCases: [],
        licenses: [],
        languages: [],

        async loadCases() {
            const response = await $http.get("/cases");
            service.cases = Array.isArray(response.data.result) ? response.data.result : [];
            return service.cases;
        },

        async loadPublicCases() {
            const response = await $http.get("/cases", {
                params: { scope: "public" },
            });
            service.publicCases = Array.isArray(response.data.result) ? response.data.result : [];
            return service.publicCases;
        },

        async getCases(reload = false) {
            if (reload || service.cases.length === 0) {
                await service.loadCases();
            }
            return service.cases;
        },

        async getPublicCases(reload = false) {
            if (reload || service.publicCases.length === 0) {
                await service.loadPublicCases();
            }
            return service.publicCases;
        },

        async getCaseById(caseId) {
            const response = await $http.get(`/cases/${caseId}`);
            return response.data.result;
        },

        async getCaseByDesignId(designId) {
            const response = await $http.get(`/designs/${designId}/case`);
            return response.data.result;
        },

        async searchCases(query) {
            const trimmedQuery = String(query || "").trim();
            if (trimmedQuery.length < 2) {
                return [];
            }
            const response = await $http.get("/cases/search", {
                params: { q: trimmedQuery },
            });
            return Array.isArray(response.data.result) ? response.data.result : [];
        },

        async getCaseDownloadLink(caseId) {
            const response = await $http.get(`/cases/${caseId}/download-link`);
            return response.data.result;
        },

        async getCaseDocumentProcessing(caseId) {
            const response = await $http.get(`/cases/${caseId}/document-processing`);
            return response.data.result;
        },

        async getLicenses(reload = false) {
            if (reload || service.licenses.length === 0) {
                const response = await $http.get("/licenses");
                service.licenses = Array.isArray(response.data.result) ? response.data.result : [];
            }
            return service.licenses;
        },

        async getLanguages(reload = false) {
            if (reload || service.languages.length === 0) {
                const response = await $http.get("/languages");
                service.languages = Array.isArray(response.data.result) ? response.data.result : [];
            }
            return service.languages;
        },

        async createCase(caseData) {
            const formData = new FormData();
            formData.append("title", caseData.title);
            formData.append("pdf", caseData.pdf);
            appendCaseSharingFields(formData, caseData);

            const response = await $http.post("/cases", formData, {
                headers: { "Content-Type": undefined },
            });

            await service.getCases(true);
            await service.getPublicCases(true);
            return response.data.result;
        },

        async updateCase(caseId, caseData) {
            const formData = new FormData();
            formData.append("title", caseData.title);
            appendCaseSharingFields(formData, caseData);

            if (caseData.pdf) {
                formData.append("pdf", caseData.pdf);
            }

            const response = await $http.patch(`/cases/${caseId}`, formData, {
                headers: { "Content-Type": undefined },
            });

            await service.getCases(true);
            await service.getPublicCases(true);
            return response.data.result;
        },

        async deleteCase(caseId) {
            await $http.delete(`/cases/${caseId}`);
            await service.getCases(true);
            await service.getPublicCases(true);
        },

        async updateCaseVisibility(caseId, visibility) {
            const response = await $http.patch(`/cases/${caseId}/visibility`, { visibility });
            await service.getCases(true);
            await service.getPublicCases(true);
            return response.data.result;
        },

        async importCase(caseId) {
            const response = await $http.post(`/cases/${caseId}/import`);
            await service.getCases(true);
            await service.getPublicCases(true);
            return response.data.result;
        },
    };

    return service;
};

export { CasesCatalogService };
