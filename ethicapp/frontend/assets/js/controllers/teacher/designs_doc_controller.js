/*eslint func-style: ["error", "expression"]*/
export function DesignsDocController($scope, DesignStateService, $http, Notification, $timeout) { 
    const vm = this;
    vm.busy = false;
    vm.documents = [];
    vm.designId = 0;
    vm.designObj = null;
    vm.selectedFile = null;

    vm.init = async function(){
        console.debug("[DesignsDocController::init]");
        $scope.$on('workingDesignChanged', async function(event, data) {
            console.log("[DesignsDocController::workingDesignUpdated");
            vm.designId = data.designId;
            vm.designObj = data.designObj;

            // Refresh the documents
            await vm.requestDesignDocuments();
        });
    };
    
    vm.uploadDesignDocument = async function (file) {
        console.log("[DesignDocumentsController::uploadDesignDocument]");
    
        if (file) {
            const maxSize = 20 * 1024 * 1024; // 20 MB
            if (file.size <= maxSize) {
                vm.busy = true;

                const formData = new FormData();
                formData.append('pdf', file);
                formData.append('dsgnid', vm.designId);
    
                try {
                    const response = await $http.post("upload-design-file", 
                        formData, {
                            transformRequest: angular.identity,
                            headers: { "Content-Type": undefined }
                        });
                    
                    if (response.data.status === "ok") {
                        console.log("Document uploaded successfully.");
                        vm.requestDesignDocuments(); // Update document list
                    }
                } catch (error) {
                    console.error("Error uploading design file:", error);
                } finally {
                    vm.busy = false;
                }
            } else {
                Notification.error("File is too large. Maximum size allowed is 20 MB.");
            }
        }
    };
    
    vm.requestDesignDocuments = async function() {
        try {
            // Prepare the request payload
            const postdata = { dsgnid: vm.designId };
    
            // Make an asynchronous HTTP POST request to fetch design documents
            const response = await $http({
                url: "designs-documents",
                method: "post",
                data: postdata
            });
    
            // Assign the response data to `vm.documents`
            vm.documents = response.data;

            // Ensure the DOM is updated
            $scope.$applyAsync(); 
    
        } catch (error) {
            // Log any errors encountered during the HTTP request
            console.error("Error fetching design documents:", error);
        }
    };
        
    vm.deleteDesignDocument = function (dsgnid) {
        var postdata = { dsgnid: dsgnid };
        $http({
            url: "delete-design-document",
            method: "post",
            data: postdata
        })
        .then(function () {
            vm.requestDesignDocuments();
        })
        .catch(function (error) {
            console.error("Error deleting design document:", error);
        });
    };    

    vm.getPathname = function(path) {
        var split = path.split("/");
        return split[split.length - 1];
    };

    vm.openPDFInNewTab = function (pdfPath) {
        window.open(pdfPath, "_blank");
    };

    vm.init();
};