export let DocumentsService = ($http) => {
    let service = {

    };

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

    return service;
};