/*eslint func-style: ["error", "expression"]*/
export let DesignsDocController = ($scope, DesignStateService, $http, Notification, $timeout) => { 
    var self = $scope;
    self.busy = false;
    self.documents = [];
    self.designId = DesignStateService.designState;

    self.init = function(){
        self.requestDesignDocuments();
    };

    self.uploadDesignDocument = function (event) { //Work in progress
        var fileInput = event.target.querySelector('input[type="file"]');
        var file = fileInput.files[0];

        if (file){
            var maxSize = 20 * 1024 * 1024; // 20 MB
            if (file.size <= maxSize) {
                self.busy = true;
                var fd = new FormData(event.target);
                $http.post("upload-design-file", fd, {
                    transformRequest: angular.identity,
                    headers: { "Content-Type": undefined }
                })
                .then(function (response) {
                    if (response.data.status === "ok") {
                        $timeout(function () {
                            //Notification.success("Documento cargado correctamente");
                            event.target.reset();
                            self.busy = false;
                            //self.shared.updateDocuments();
                            self.requestDesignDocuments();
                        }, 2000);
                    }
                })
                .catch(function (error) {
                    console.error("Error uploading design file:", error);
                });                
            }
            else{
                Notification.error("Documento muy grande. El tamaño máximo permitido es 20 MB.");
            }

        }
    };
    
    self.requestDesignDocuments = function () {
        console.log(self.designId);
        var postdata = { dsgnid: self.designId.id };
        $http({
            url: "designs-documents",
            method: "post",
            data: postdata
        })
        .then(function (response) {
            self.documents = response.data;
        })
        .catch(function (error) {
            console.error("Error fetching design documents:", error);
        });
    };
    
    self.deleteDesignDocument = function (dsgnid) {
        var postdata = { dsgnid: dsgnid };
        $http({
            url: "delete-design-document",
            method: "post",
            data: postdata
        })
        .then(function () {
            self.requestDesignDocuments();
        })
        .catch(function (error) {
            console.error("Error deleting design document:", error);
        });
    };    

    self.getPathname = function(path){
        var split = path.split("/");
        return split[split.length - 1];
    };

    self.openPDFInNewTab = function (pdfPath) {
        window.open(pdfPath, "_blank");
    };

    self.init();
};