/*eslint func-style: ["error", "expression"]*/
export let SesEditorController = ($scope, $http, Notification) => {
    var self = $scope;

    self.mTransition = { 1: 3, 3: 5, 5: 6, 6: 8, 8: 9 };

    self.splitDescr = false;
    self.splDes1 = "";
    self.splDes2 = "";

    self.toggleSplit = function () {
        self.splitDescr = !self.splitDescr;
        if (self.splitDescr) {
            self.splDes1 = self.selectedSes.descr.split("\n")[0];
            self.splDes2 = self.selectedSes.descr.split("\n")[1] || "";
        } else {
            self.selectedSes.descr = self.splDes1 + "\n" + self.splDes2;
        }
    };

    self.updateSession = function () {
        if (self.splitDescr) {
            self.selectedSes.descr = self.splDes1 + "\n" + self.splDes2;
        }
        if (self.selectedSes.name.length < 3 || self.selectedSes.descr.length < 5) {
            Notification.error("Datos de la sesión incorrectos o incompletos");
            return;
        }
        var postdata = {
            name: self.selectedSes.name, descr: self.selectedSes.descr, id: self.selectedSes.id
        };
        $http({ url: "update-session", method: "post", data: postdata }).success(function () {
            console.log("Session updated");
        });
    };

    self.shared.changeState = function () {
        var confirm = window.confirm("¿Esta seguro que quiere ir al siguiente estado?");
        if (confirm) {
            if (self.selectedSes.status == 1) {
                self.updateSession();
            }
            var _postdata = { sesid: self.selectedSes.id };
            $http({
                url: "change-state-session", method: "post", data: _postdata
            }).success(function () {
                self.shared.updateSesData();
            });
        }
    };
};