/*eslint func-style: ["error", "expression"]*/
export let DesignsDocController = ($scope, DesignsService, DocumentsService, 
    $http, Notification, $timeout) => { 
    let self = $scope;
    self.busy = false;
    self.documents = [];

    self.init = () => {
        self.requestDesignDocuments();
    };

    self.uploadDesignDocument = (event) => {
        let fileInput = event.target.querySelector('input[type="file"]');
        let file = fileInput.files[0];

        if (!file) {
            Notification.error("No se encuentra el archivo para subir");
            throw new Error("[DesignsDocController.uploadDesignDocument] File not found");
        }

        const maxDocumentSize = 20 * (1 << 20); // 20 MB

        if (file.size > maxDocumentSize) {
            Notification.error("El archivo excede el tamaño límite");
            throw new Error("[DesignsDocController.uploadDesignDocument] File too large");
        }

        self.busy = true; // Show spinner
        let fd = new FormData(event.target);

        DocumentsService.uploadDesignDocument(fd)
            .catch(error => {
                Notification.error("Error subiendo el documento al servidor");
                console.log(`[DesignsDocController.uploadDesignDocument] Error: ${error}`);
            }).then(result => {
                const designId = DesignsService.workingDesignId;
                DocumentsService.loadDesignDocuments(designId)
                    .catch(error => {
                        Notification.error("Error cargando los documentos del diseño actual");
                    });
            }).finally(() => {
                event.target.reset();
                self.busy = false;
            });
    };
    
    self.requestDesignDocuments = () => {
        var postdata = { designId: DesignsService.workingDesignId };
        $http({
            url: "designs-documents", method: "post", data: postdata
        }).success(function (data) {
            self.documents = data;
        });
    };

    self.deleteDesignDocument = (designId) => {
        let postdata = { designId: designId };
        $http({
            url: "delete-design-document", method: "post", data: postdata
        }).success(function () {
            self.requestDesignDocuments();
        });
    };

    self.getPathname = (path) => {
        let tokens = path.split("/");
        return tokens[tokens.length - 1];
    };

    self.openPDFInNewTab = (pdfPath) => {
        window.open(pdfPath, "_blank");
    };

    self.init();
};