let DesignCatalogService = ($http) => {
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
            
            // Find the design by id
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
        }
    };

    return service;
};

export { DesignCatalogService };
