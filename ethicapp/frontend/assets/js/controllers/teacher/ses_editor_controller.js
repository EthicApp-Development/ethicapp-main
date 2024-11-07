/*eslint func-style: ["error", "expression"]*/
export let SesEditorController = ($scope, $http, Notification, ActivityStateService) => {
    var self = $scope;

    self.mTransition = { 1: 3, 3: 5, 5: 6, 6: 8, 8: 9 };

    self.splitDescr = false;
    self.splDes1 = "";
    self.splDes2 = "";

    self.toggleSplit = function () {
        self.splitDescr = !self.splitDescr;
        if (self.splitDescr) {
            self.splDes1 = ActivityStateService.sessionDescriptor.descr.split("\n")[0];
            self.splDes2 = ActivityStateService.sessionDescriptor.descr.split("\n")[1] || "";
        } else {
            ActivityStateService.sessionDescriptor.descr = self.splDes1 + "\n" + self.splDes2;
        }
    };

    self.updateSession = function () {
        if (self.splitDescr) {
            ActivityStateService.sessionDescriptor.descr = self.splDes1 + "\n" + self.splDes2;
        }
        if (ActivityStateService.sessionDescriptor.name.length < 3 || 
            ActivityStateService.sessionDescriptor.descr.length < 5) {
            Notification.error("Datos de la sesión incorrectos o incompletos");
            return;
        }
        var postdata = {
            name: ActivityStateService.sessionDescriptor.name,
            descr: ActivityStateService.sessionDescriptor.descr,
            id: ActivityStateService.sessionDescriptor.id
        };
        $http({ url: "update-session", method: "post", data: postdata })
            .then(function () {
                console.log("Session updated");
            })
            .catch(function (error) {
                console.error("Error updating session:", error);
            });
    };
    
    self.shared.changeState = function () {
        var confirm = window.confirm("¿Está seguro que quiere ir al siguiente estado?");
        if (confirm) {
            if (ActivityStateService.sessionDescriptor.status === 1) {
                self.updateSession();
            }
            var _postdata = { sesid: ActivityStateService.sessionDescriptor.id };
            $http({ url: "change-state-session", method: "post", data: _postdata })
                .then(function () {
                    self.shared.updateSesData();
                })
                .catch(function (error) {
                    console.error("Error changing session state:", error);
                });
        }
    };
    
    /*self.exportData = () => {
        let postdata = {id: self.selectedSes.id};
        $http.post("export-session-data-sel", postdata).success((data) => {
            let anchor = angular.element('<a/>');
            anchor.attr({
                href: 'data:attachment/vnd.openxmlformats,' + encodeURI(data),
                target: '_blank',
                download: 'resultados.xlsx'
            })[0].click();
        });
    }*/
};