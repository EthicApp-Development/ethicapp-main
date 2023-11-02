export let DesignsService = ($rootScope, $http) => {
    var service = { 
        userDesigns:   [],
        publicDesigns: []
    };
    
    service.workingDesign = {
    };

    service.setWorkingDesign = (design) => {
        service.workingDesign = design;
        $rootScope.$broadcast('DesignsService_workingDesignUpdated', design);
    };

    service.togglePublishDesign = (designId) => {
        let postdata = { id: designId };
        return $http({ 
            url:    "design-public", 
            method: "post", 
            data:   postdata })
            .catch(error => { 
                console.log(
                    `[Designs Service] unable to toggle publish design with id:'${designId}'.`);
                throw new Error(error);
            });
    };

    service.resolveDesignTypeCharacter = (design) => {
        if (Object.keys(design).length === 0 || design == null ||
            !("metainfo" in design) || !("type" in design.metainfo)) {
            throw new Error("Invalid design"); 
        }
        return design.metainfo.type == "semantic_differential" ? "T" : "R";
    };

    service.toggleLockDesign = function (designId) {
        let postdata = { id: designId };
        return $http({ 
            url:    "design-lock", 
            method: "post", 
            data:   postdata 
        }).catch(error => {
            console.log(`[Designs Service] unable to toggle lock design with id:'${designId}'.`);
            throw new Error(error);
        });
    };

    service.loadUserDesigns = function(){
        // Get all designs by the current user
        return $http.get("get-user-designs").then((data) => {
            if (data.status == "ok") {
                service.userDesigns = data.result;
            }
        }).catch(error => {
            console.log("[Designs Service] unable to get designs by the current user.");
            throw new Error(error);
        });
    };

    self.loadPublicDesigns = function(){
        // Get all public designs
        return $http.get("get-public-designs").then((data) => {
            if (data.status == "ok") {
                service.publicDesigns = data.result;
            }
            else {
                throw new Error("Failed to get public designs.");
            }
        });
    };

    self.loadUserDesignById = (designId) => {
        var postdata = { id: designId };
        return $http.post("get-design", postdata)
            .then((data) => {
                if (data.status == "ok") {
                    self.setWorkingDesign(data.result);
                    service.workingDesign.id = designId;
                    return Promise.resolve(data.result);
                }
                else {
                    throw new Error("Failed to load user design.");
                }
            }).catch((error) => {
                console.log(`[Designs Service] Failed to load design by id:'${designId}'`);
                throw new Error(error);
            });        
    };

    self.importPublicDesignById = (designId) => {
        // TODO: implement
    };

    self.createDesign = (design) => {
        return $http.post("upload-design", design)
            .then(function (data) {
                if (data.status == "ok") {
                    return Promise.resolve(data.id);
                }
                else {
                    throw new Error("Could not create design");
                }
            }).catch(error => {
                console.log("[Designs Service] Failed to create design" +
                    `design: ${error}`);
            });
    };

    self.updateDesign = (designId, design) => {
        var postdata = { 
            "design": design, 
            "id":     designId
        };

        return $http.post("update-design", postdata)
            .then((response) => {
                if (response.data.status != "ok") {
                    throw new Error("[DesignsService.saveDesign] Failed to update design");
                }
                return Promise.resolve(response);
            });
    };

    self.deleteDesign = (designId) => {
        var postdata = { id: designId };
        return $http.post("delete-design", postdata).then((data) => {
            if (data.status == "ok") {
                // Update available designs after delete 
                service.getUserDesigns();
            }
            else {
                throw new Error("Failed to delete design.");
            }
        });
    };
    
    return service;
};