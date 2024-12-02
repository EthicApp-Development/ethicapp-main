let DesignCatalogService = ($rootScope, $http) => {
    const service = {
        designs: [],

        async loadDesigns() {
            try {
                const response = await $http.get("/designs");
                
                if (response.data.status === "ok" && Array.isArray(response.data.result)) {
                    service.designs = response.data.result;
                    if (typeof service.designs === "string") {
                        service.designs = JSON.parse(service.designs);
                    }
                    service.notifySubscribers();
                } else {
                    console.error("Error: Unexpected response format", response.data);
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
            const result = service.designs.filter(design => design.public === true)
            return result;
        },

        async getDesignById(id, reload = false) {
            if (reload || service.designs.length === 0) {
                await service.loadDesigns();
            }
            return service.designs.find(design => design.id === id) || null;
        },

        async togglePublicVisibility(id) {
            const postdata = { dsgnid: id };
            try {
                await $http({ url: "design-public", method: "post", data: postdata });
                service.loadDesigns();
            }
            catch (error) {
                console.log(`Failed to change public property of design with id:'${id}'`);
            }
        },

        async toggleDesignLock(id) {
            const postdata = { dsgnid: id };
            try {
                await $http({ url: "design-lock", method: "post", data: postdata });
                service.loadDesigns();
            }
            catch (error) {
                console.log(`Failed to lock design with id:'${id}'`);
            }
        },

        async deleteDesign(id) {
            try {
                const postdata = { id: id };
                const response = await $http.post("delete-design", postdata);
                const data = response.data;
            
                if (data.status === "ok") {
                    await service.getDesigns(true);
                } else {
                    console.error("Error deleting design: Unexpected response status", data);
                }
            } catch (error) {
                console.error("Error deleting design:", error);
            }
        },

        async updateDesign(designId, designObj) {
            try {
                const postdata = { "id": designId, "design": designObj };
                const response = await $http.post("/update-design", postdata);
        
                if (response.data.status === "ok") {
                    await service.loadDesigns();
                    return true;
                } else {
                    throw new Error("Failed to update design");
                }                
            } catch (error) {
                console.error("Error updating design: ", error);
                return false;
            }
        },

        async validateDesign(designId) {
        
            const response = await $http({
                url:    "check-design",
                method: "post",
                data:   { dsgnid: designId }
            });
            
            if (!response.data.result) {
                throw new Error("Could not validate the design.");
            }
            
            return response.data.result; 
        },

        notifySubscribers: function() {
            $rootScope.$broadcast('designCatalogUpdated', service.designs);
        }        
    };

    return service;
};

export { DesignCatalogService };
