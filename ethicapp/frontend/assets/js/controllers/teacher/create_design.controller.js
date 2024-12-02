/*eslint func-style: ["error", "expression"]*/
export function CreateDesignController($scope, $http, 
    DesignCatalogService) {

    const vm = this;

    vm.init = async function() {
        //console.log(`[CreateDesignController] DesignCatalogService: ${DesignCatalogService.loadDesigns}`);
    };

    vm.uploadDesign = async function (title, author, type) {
        var semantic = { 
            "metainfo": {
                "title":         title,
                "author":        author,
                "creation_date": Date.now()
            },
            "roles":  [],
            "type":   "semantic_differential",
            "phases": [
                {
                    "mode":               "individual",
                    "chat":               false,
                    "anonymous":          true,
                    "grouping_algorithm": "random",
                    "prevPhasesResponse": [ ],
                    "stdntAmount":        3,
                    "questions":          [
                        {
                            "q_text":     "-->>N/A<<--",
                            "ans_format": {
                                "values":          7,
                                "l_pole":          "-->>N/A<<--",
                                "r_pole":          "-->>N/A<<--",
                                "just_required":   true,
                                "min_just_length": 5
                            }
                        }
                    ]
                }
            ]
        };
        var ranking = { 
            "metainfo": {
                "title":         title,
                "author":        author,
                "creation_date": Date.now()
            },
            "roles":  [],
            "type":   "ranking",
            "phases": [
                {
                    "mode":               "individual",
                    "chat":               false,
                    "anonymous":          true,
                    "grouping_algorithm": "random",
                    "prevPhasesResponse": [ ],
                    "stdntAmount":        3,
                    "q_text":             "-->>N/A<<--",
                    "roles":              [
                    ]
                }
            ]
        };
        if(type) {
            let requestParams = {};

            if (type === "semantic_differential"){
                requestParams = { design: semantic };
            }
            else if (type== "ranking"){
                requestParams = { design: ranking };
            }

            try {
                // Send POST request to upload design
                const response = await $http.post("/upload-design", requestParams);
                
                // Check if the response status is "ok"
                if (response.data.status === "ok") {
                    await DesignCatalogService.loadDesigns();
                    console.debug("Design uploaded successfully and catalog reloaded.");
                } else {
                    // Handle unexpected status in the response
                    throw new Error("Unexpected response status: " + response.data.status);
                }

                const designId = response.data.id;

                // Switch to the editor view
                //console.log(`[CreateDesignController] Attempting to open /designs/${designId}/edit navigateTo: ${$scope.navigateTo}`);
                $scope.navigateTo(`/designs/${designId}/edit`);
            } catch (error) {
                // Log and handle any errors encountered during the HTTP request or response processing
                console.error("Error uploading design:", error.message || error);
            }
        }
    };    
    vm.init();
};