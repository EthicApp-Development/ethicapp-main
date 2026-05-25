let DesignCatalogService = ($rootScope, $http) => {
    const service = {
        designs: [],
        hasLoadedDesigns: false,
        listeners: {}, // Subscribed listeners

        async loadDesigns() {
            try {
                const response = await $http.get("/designs");

                // Validate the response structure
                if (response.data.status === "ok" && Array.isArray(response.data.result)) {
                    service.designs = response.data.result; // Assign the fetched designs
                    service.hasLoadedDesigns = true;
                } else {
                    console.error("Error: Unexpected response format", response.data);
                    // Optional: Handle unexpected response formats (e.g., show an error to the user)
                }
            } catch (error) {
                console.error("Error loading designs:", error);
            }
        },

        applyPrivateVisibilityToDesigns(designIds = []) {
            const affectedDesignIds = new Set(designIds.map(id => Number(id)));
            if (affectedDesignIds.size === 0) {
                return;
            }

            service.designs.forEach((design) => {
                if (affectedDesignIds.has(Number(design.id))) {
                    design.visibility = "private";
                    design.public = false;
                }
            });

            service.notifyListeners("onDesignCatalogUpdated", {
                response: null,
            });
        },

        async getDesigns(reload = false) {
            if (reload || !service.hasLoadedDesigns) {
                await service.loadDesigns();
            }
            return service.designs;
        },

        async getUserDesigns(reload = false) {
            if (reload || !service.hasLoadedDesigns) {
                await service.loadDesigns();
            }
            const result = service.designs.filter(design => design.userOwned === true && design.archived !== true);
            return result;
        },

        async getArchivedDesigns(reload = false) {
            if (reload || !service.hasLoadedDesigns) {
                await service.loadDesigns();
            }
            const result = service.designs.filter(design => design.userOwned === true && design.archived === true);
            return result;
        },

        async getPublicDesigns(reload = false) {
            if (reload || !service.hasLoadedDesigns) {
                await service.loadDesigns();
            }
            const result = service.designs.filter(design => design.visibility === "public" &&
                design.valid === true && design.userOwned === false && design.archived !== true);
            return result;
        },

        async getDesignById(id, reload = false) {
            if (reload || !service.hasLoadedDesigns) {
                await service.loadDesigns();
            }
            return service.designs.find(design => design.id === id) || null;
        },

        async createDesign(design) {
            try {
                const tagIds = (design.tags || []).map(tag => tag.id);
                // Make the POST request to the API
                const response = await $http.post("/designs", {
                    design,
                    caseId: design.caseId ?? null,
                    languageCode: design.languageCode,
                    tagIds,
                });

                // Check the response status
                if (response.data.status === "ok") {
                    const newDesignId = response.data.id;

                    // Add the ID to the design object
                    design.id = newDesignId;
                    design.public = false;
                    design.visibility = "private";
                    design.locked = false;
                    design.archived = false;
                    design.userOwned = true;
                    design.languageCode = design.languageCode || "en_US";

                    // Add the new design to the service's local list
                    service.designs.unshift(design);

                    // Notify listeners
                    service.notifyListeners("onDesignCatalogUpdated", {
                        response: null });
                    return newDesignId; // Return the new design ID
                } else {
                    throw new Error("Failed to create design");
                }
            } catch (error) {
                console.error("Error creating design:", error);
                return null; // Return null to indicate failure
            }
        },

        async togglePublicVisibility(id) {
            const design = service.designs.find(d => d.id === id);
            if (!design) return;

            const previousPublic = design.public;
            const previousVisibility = design.visibility || (design.public ? "public" : "private");

            try {
                const response = await $http({ url: `/designs/${id}/toggle_public`, method: "PATCH" });
                const result = response.data?.result || {};
                design.visibility = result.visibility || (design.public ? "public" : "private");
                design.public = result.public === true || design.visibility === "public";
                design.caseId = result.caseId ?? design.caseId;

                // Notify listeners
                service.notifyListeners("onDesignCatalogUpdated", {
                    response: null });
                return result;
            } catch (error) {
                console.error(`Failed to change public property of design with id: '${id}'`, error);

                design.public = previousPublic;
                design.visibility = previousVisibility;

                // Notify listeners
                service.notifyListeners("onDesignCatalogUpdated", {
                    response: null });
                throw error;
            }
        },

        async lockDesign(id, local = false) {
            try {
                // Make the API call to toggle the lock property
                if (!local) {
                    await $http({ url: `/designs/${id}/lock`, method: "PATCH" });
                }

                // Update the locked status of the design locally
                const design = service.designs.find(d => d.id === id);
                if (design) {
                    design.locked = !design.locked; // Toggle the lock status locally

                    // Notify listeners
                    service.notifyListeners("onDesignCatalogUpdated", {
                        response: null });
                }
            } catch (error) {
                console.error(`Failed to toggle lock property of design with id: '${id}'`, error);
                // Optional: Notify the user about the failure
            }
        },

        async importDesign(id) {
            try {
                // Make the API call to duplicate the design
                const response = await $http({ url: `/designs/${id}/duplicate`, method: "POST" });

                // Check if the duplication was successful
                if (response.data.status === "ok" && response.data.id) {
                    await service.getDesigns(true);
                    service.notifyListeners("onDesignCatalogUpdated", {
                        response: null });
                } else {
                    console.error("Error: Unexpected response format during design import", response.data);
                    throw new Error("Unexpected response format during design import");
                }
            } catch (error) {
                console.error(`Failed to import design with id: '${id}'`, error);
                throw error;
            }
        },

        async duplicateDesign(id) {
            // Implementation of duplication is exactly the same as importing
            await service.importDesign(id);
        },

        async deleteDesign(id) {
            try {
                // Make the DELETE request to the API
                const response = await $http({
                    url: `/designs/${id}`,
                    method: "DELETE",
                });

                // Check the response status
                const data = response.data;
                if (data.status === "ok") {
                    // Reload the designs after successful deletion
                    await service.getDesigns(true);
                    service.notifyListeners("onDesignCatalogUpdated", {
                        response: null });
                } else {
                    console.error("Error deleting design: Unexpected response status", data);
                }
            } catch (error) {
                console.error(`Error deleting design with id '${id}':`, error);
            }
        },

        async updateDesignArchived(id, archived) {
            try {
                const response = await $http({
                    url: `/designs/${id}/archive`,
                    method: "PATCH",
                    data: { archived },
                });

                const design = service.designs.find(d => d.id === id);
                if (design) {
                    design.archived = response.data?.result?.archived === true;
                }
                await service.getDesigns(true);
                service.notifyListeners("onDesignCatalogUpdated", {
                    response: null });
                return response.data.result;
            } catch (error) {
                console.error(`Error updating archived status for design with id '${id}':`, error);
                throw error;
            }
        },

        async updateDesign(designId, designObj) {
            try {
                const tagIds = (designObj.tags || []).map(tag => tag.id);
                // Make the PATCH request to the API
                const response = await $http({
                    url: `/designs/${designId}`,
                    method: "PATCH",
                    data: {
                        design: designObj,
                        caseId: designObj.caseId ?? null,
                        languageCode: designObj.languageCode,
                        tagIds,
                    }, // Send the updated design object in the request body
                });

                // Check the response status
                if (response.data.status === "ok") {
                    // Reload the designs after successful update
                    await service.loadDesigns();
                    service.notifyListeners("onDesignCatalogUpdated", {
                        response: null });
                    return true;
                } else {
                    throw new Error("Failed to update design");
                }
            } catch (error) {
                console.error(`Error updating design with id '${designId}':`, error);
                return false;
            }
        },

        isDesignValid: async function(designId) {
            try {
                // Call the API endpoint
                const response = await $http.get(`/designs/${designId}/valid`);
                // console.debug(`[isDesignValid] ${JSON.stringify(response)}`);

                // Check the response
                if (response.data.status === 'ok' && typeof response.data.valid === 'boolean') {
                    return response.data.valid; // Return the validity status
                } else {
                    console.error('Unexpected response format:', response.data);
                    throw new Error('Invalid response format');
                }
            } catch (error) {
                console.error('Error checking design validity:', error);
                throw error; // Propagate the error
            }
        },

        registerListener: (eventName, callback) => {
            if (!service.listeners[eventName]) {
                service.listeners[eventName] = [];
            }
            service.listeners[eventName].push(callback);
        },

        unregisterListener: function (eventName, callback) {
            if (service.listeners[eventName]) {
                service.listeners[eventName] = service.listeners[eventName].filter(
                    (listener) => listener !== callback
                );
            }
        },

        notifyListeners: (eventName, data) => {
            if (service.listeners[eventName]) {
                service.listeners[eventName].forEach((callback) => callback(data));
            }
        },
    };

    return service;
};

export { DesignCatalogService };
