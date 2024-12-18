let DesignCatalogService = ($rootScope, $http) => {
    const service = {
        designs: [],

        async loadDesigns() {
            try {
                const response = await $http.get("/designs");
        
                // Validate the response structure
                if (response.data.status === "ok" && Array.isArray(response.data.result)) {
                    service.designs = response.data.result; // Assign the fetched designs
                    service.notifySubscribers(); // Notify any subscribers
                } else {
                    console.error("Error: Unexpected response format", response.data);
                    // Optional: Handle unexpected response formats (e.g., show an error to the user)
                }
            } catch (error) {
                console.error("Error loading designs:", error);
            }
        },

        async getDesigns(reload = false) {
            if (reload || service.designs.length === 0) {
                await service.loadDesigns();
            }
            return service.designs;
        },

        async getUserDesigns(reload = false) {
            if (reload || service.designs.length === 0) {
                await service.loadDesigns();
            }
            const result = service.designs.filter(design => design.userOwned === true);
            return result;
        },

        async getPublicDesigns(reload = false) {
            if (reload || service.designs.length === 0) {
                await service.loadDesigns();
            }
            const result = service.designs.filter(design => design.public === true && 
                design.valid === true);
            return result;
        },

        async getDesignById(id, reload = false) {
            if (reload || service.designs.length === 0) {
                await service.loadDesigns();
            }
            return service.designs.find(design => design.id === id) || null;
        },

        async createDesign(design) {
            try {
                // Make the POST request to the API
                const response = await $http.post("/designs", { design });

                // Check the response status
                if (response.data.status === "ok") {
                    const newDesignId = response.data.id;

                    // Add the ID to the design object
                    design.id = newDesignId;

                    // Add the new design to the service's local list
                    service.designs.push(design);

                    // Notify subscribers about the update
                    service.notifySubscribers();

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
        
            const previousValue = design.public; // Save the previous state
        
            try {        
                // Make the API call to toggle the public property
                await $http({ url: `/designs/${id}/toggle_public`, method: "PATCH" });
        
                // Notify subscribers to confirm the change
                service.notifySubscribers();
            } catch (error) {
                console.error(`Failed to change public property of design with id: '${id}'`, error);
        
                // Revert on API failure
                design.public = previousValue;
                service.notifySubscribers();
            }
        },

        async toggleDesignLock(id) {
            try {
                // Make the API call to toggle the lock property
                await $http({ url: `/designs/${id}/toggle_lock`, method: "PATCH" });
        
                // Update the locked status of the design locally
                const design = service.designs.find(d => d.id === id);
                if (design) {
                    design.locked = !design.locked; // Toggle the lock status locally
                    service.notifySubscribers(); // Notify subscribers about the update
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
                    const newDesignId = response.data.id;
        
                    // Fetch the original design (with the option to reload if necessary)
                    const originalDesign = await service.getDesignById(id);
        
                    if (originalDesign) {
                        // Clone the original design and update its properties
                        const importedDesign = {
                            ...originalDesign,
                            id: newDesignId,
                            userOwned: true,
                        };
        
                        // Add the imported design locally
                        service.designs.push(importedDesign);
                        service.notifySubscribers(); // Notify subscribers of the update
                    } else {
                        console.warn(`Original design with id: '${id}' not found after duplication.`);
                    }
                } else {
                    console.error("Error: Unexpected response format during design import", response.data);
                    // Optional: Notify the user about the failure
                }
            } catch (error) {
                console.error(`Failed to import design with id: '${id}'`, error);
                // Optional: Notify the user about the failure
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
                } else {
                    console.error("Error deleting design: Unexpected response status", data);
                }
            } catch (error) {
                console.error(`Error deleting design with id '${id}':`, error);
            }
        },

        async updateDesign(designId, designObj) {
            try {
                // Make the PATCH request to the API
                const response = await $http({
                    url: `/designs/${designId}`,
                    method: "PATCH",
                    data: { design: designObj }, // Send the updated design object in the request body
                });
        
                // Check the response status
                if (response.data.status === "ok") {
                    // Reload the designs after successful update
                    await service.loadDesigns();
                    return true;
                } else {
                    throw new Error("Failed to update design");
                }
            } catch (error) {
                console.error(`Error updating design with id '${designId}':`, error);
                return false;
            }
        },

        notifySubscribers: function() {
            $rootScope.$broadcast('designCatalogUpdated', service.designs);
        }        
    };

    return service;
};

export { DesignCatalogService };
