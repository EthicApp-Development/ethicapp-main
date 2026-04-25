let CasesCatalogService = ($http) => {
    const service = {
        cases: [],

        async loadCases() {
            const response = await $http.get("/cases");
            service.cases = Array.isArray(response.data.result) ? response.data.result : [];
            return service.cases;
        },

        async getCases(reload = false) {
            if (reload || service.cases.length === 0) {
                await service.loadCases();
            }
            return service.cases;
        },

        async getCaseById(caseId) {
            const response = await $http.get(`/cases/${caseId}`);
            return response.data.result;
        },

        async createCase(caseData) {
            const formData = new FormData();
            formData.append("title", caseData.title);
            formData.append("author_firstname", caseData.authorFirstname);
            formData.append("author_lastname", caseData.authorLastname);
            formData.append("author_email", caseData.authorEmail);
            formData.append("pdf", caseData.pdf);

            const response = await $http.post("/cases", formData, {
                headers: { "Content-Type": undefined },
            });

            await service.getCases(true);
            return response.data.result;
        },

        async updateCase(caseId, caseData) {
            const formData = new FormData();
            formData.append("title", caseData.title);
            formData.append("author_firstname", caseData.authorFirstname);
            formData.append("author_lastname", caseData.authorLastname);
            formData.append("author_email", caseData.authorEmail);

            if (caseData.pdf) {
                formData.append("pdf", caseData.pdf);
            }

            const response = await $http.patch(`/cases/${caseId}`, formData, {
                headers: { "Content-Type": undefined },
            });

            await service.getCases(true);
            return response.data.result;
        },

        async deleteCase(caseId) {
            await $http.delete(`/cases/${caseId}`);
            await service.getCases(true);
        },
    };

    return service;
};

export { CasesCatalogService };
