/*eslint func-style: ["error", "expression"]*/
export function DesignsDocController($scope, DesignStateService, $http, Notification, $timeout) { 
    const vm = this;
    vm.busy = false;
    vm.documents = [];

    vm.init = async function(){
        vm.designId = await DesignStateService.getDesignId();
        vm.designObj = await DesignStateService.getDesignObj();
        vm.requestDesignDocuments();
    };

    vm.uploadDesignDocument = function (event) { //Work in progress
        var fileInput = event.target.querySelector('input[type="file"]');
        var file = fileInput.files[0];

        if (file) {
            const maxSize = 20 * 1024 * 1024; // 20 MB
            if (file.size <= maxSize) {
                vm.busy = true;
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
                            vm.busy = false;
                            //self.shared.updateDocuments();
                            vm.requestDesignDocuments();
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
    
    vm.requestDesignDocuments = function () {
        console.log(vm.designId);
        var postdata = { dsgnid: vm.designId };
        $http({
            url: "designs-documents",
            method: "post",
            data: postdata
        })
        .then(function (response) {
            vm.documents = response.data;
        })
        .catch(function (error) {
            console.error("Error fetching design documents:", error);
        });
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

    vm.getPathname = function(path){
        var split = path.split("/");
        return split[split.length - 1];
    };

    vm.openPDFInNewTab = function (pdfPath) {
        window.open(pdfPath, "_blank");
    };

    vm.init();
};