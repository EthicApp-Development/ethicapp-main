export let DocumentsService = ($http) => {
    let service = {

    };

    // Deprecated
    service.loadDocumentsForSession = (sessionId) => {
        var postdata = { sesid: sessionId };
        return $http({
            url: "documents-session", method: "post", data: postdata
        }).then(function (data) {
            if (data == null || Object.keys(data) === 0) {
                throw new Error("[Documents Service] Got null or empty document set");
            }
            service.documents = data;
        }).catch(error => {
            console.log("[Documents Service] Failed to load documents!");
            throw error;
        });
    };

    service.loadDesignDocuments = (designId) => {
        var postdata = { dsgnid: designId };
        return $http({
            url: "designs-documents", method: "post", data: postdata
        }).then(function (data) {
            service.documents = data;
        });
    };

    service.uploadDesignDocument = (documentData) => {
        // NOTE: documentData is actually formData from which the file has been submitted
        // The formData object must include a variable containing the design id (dsgnid).
        return $http.post("upload-design-file", documentData, {
            transformRequest: angular.identity,
            headers:          { "Content-Type" : undefined }
        }).catch(error => {
            console.log("[Documents Service] Failed to upload document!");
            throw error;
        });        
    }

    service.deleteDesignDocument = (designId) => {
        let postdata = { dsgnid: designId };
        return $http({
            url: "delete-design-document", method: "post", data: postdata
        }).then(function () {
            return service.loadDesignDocuments(designId);
        });
    };

    return service;
};