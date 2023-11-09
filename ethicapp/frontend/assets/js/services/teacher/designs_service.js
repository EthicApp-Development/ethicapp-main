import * as dtrModule from "../../libs/designs/design_type_registry.js";

export let DesignsService = ($rootScope, $http) => {
    var service = { 
        userDesigns:   [],
        publicDesigns: []
    };
    
    service.workingDesign = {
    };

    service.setWorkingDesign = (designId, design) => {
        service.workingDesign = design;
        service.workingDesignId = designId;
        $rootScope.$broadcast("DesignsService_workingDesignUpdated", 
            { 
                designId: designId,
                design:   design
            });
    };

    service.setUserDesigns = (designs) => {
        service.userDesigns = designs;
        $rootScope.$broadcast("DesignsService_userDesignsUpdated", 
            service.publicDesigns);
    };

    service.setPublicDesigns = (designs) => {
        service.publicDesigns = designs;
        $rootScope.$broadcast("DesignsService_publicDesignsUpdated", 
            service.publicDesigns);            
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

    /**
 * Resolves the character associated with the type of the given design.
 *
 * @param {Object} design - The design object to resolve.
 * @returns {string} The character associated with the type of the design.
 * @throws {Error} If the design object is invalid or if the type of the design is unknown.
 */
    function resolveDesignTypeCharacter(design) {
        if (!design || typeof design !== "object") {
            throw new Error("Invalid design object");
        }
  
        const { metainfo } = design;
        if (!metainfo || typeof metainfo !== "object" || !metainfo.type) {
            throw new Error("Invalid design metadata");
        }
  
        const type = dtrModule.lookupDesignTypeByName(metainfo.type);
        if (!type || typeof type !== "object" || !type.character) {
            throw new Error(`Unknown design type: ${metainfo.type}`);
        }
  
        return type.character;
    }

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

    service.loadUserDesigns = () =>{
        // Get all designs by the current user
        return $http.get("get-user-designs").then((data) => {
            if (data.status == "ok") {
                service.setUserDesigns(data.result);
            }
        }).catch(error => {
            console.log("[Designs Service] unable to get designs by the current user.");
            throw new Error(error);
        });
    };

    self.loadPublicDesigns = () => {
        // Get all public designs
        return $http.get("get-public-designs").then((data) => {
            if (data.status == "ok") {
                service.setPublicDesigns(data.result);
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
                    let design = data.result;
                    self.setWorkingDesign(designId, design);
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