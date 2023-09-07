/*eslint func-style: ["error", "expression"]*/
export let DocumentsController = ($scope, $http, Notification, $timeout) => {
    var self = $scope;

    self.busy = false;
    self.dfs = [];
    self.shared.dfs = self.dfs;

    self.getDifferentials = function () {
        $http.post("differentials", { sesid: self.selectedSes.id }).success(function (data) {
            data.forEach(function (df) {
                df.name = df.title;
                self.dfs[df.orden] = df;
            });
        });
    };

    self.uploadDocument = function (event) {
        self.busy = true;
        var fd = new FormData(event.target);
        $http.post("upload-file", fd, {
            transformRequest: angular.identity,
            headers:          { "Content-Type": undefined }
        }).success(function (data) {
            if (data.status == "ok") {
                $timeout(function () {
                    Notification.success("Documento cargado correctamente");
                    event.target.reset();
                    self.busy = false;
                    self.shared.updateDocuments();
                }, 2000);
            }
        });
    };

    self.sendDFS = function () {
        let k = 0;
        self.misc.dfSending = true;
        self.dfs.forEach(function (df, i) {
            let url = df.id ? "update-differential" : "add-differential";
            df.orden = i;
            df.sesid = self.selectedSes.id;
            $http.post(url, df).success(function () {
                k += 1;
                if (k == self.dfs.length - 1) {
                    Notification.success("Diferenciales guardados correctamente");
                    self.misc.dfSending = false;
                    self.getDifferentials();
                }
            });
        });
    };

    self.shared.sendDFS = self.sendDFS;

    self.getDifferentials();
};