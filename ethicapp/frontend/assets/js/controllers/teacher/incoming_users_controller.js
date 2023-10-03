/*eslint func-style: ["error", "expression"]*/
export let IncomingUsersController = ($scope, $http, Notification) => {
    var self = $scope;

    self.addToSession = function () {
        if (self.newMembs.length == 0) {
            Notification.error("No hay usuarios seleccionados para agregar");
            return;
        }
        var postdata = {
            users: self.newMembs.map(function (e) {
                return e.id;
            }),
            sesid: self.selectedSes.id
        };
        $http({ url: "add-ses-users", method: "post", data: postdata }).success(function (data) {
            if (data.status == "ok") {
                self.refreshUsers();
            }
        });
    };

    self.removeUser = function (uid) {
        if (self.selectedSes.status <= 2) {
            var postdata = { uid: uid, sesid: self.selectedSes.id };
            $http({
                url: "delete-ses-user", method: "post", data: postdata
            }).success(function (data) {
                if (data.status == "ok") {
                    self.refreshUsers();
                }
            });
        }
    };

    self.refreshUsers = function () {
        self.getNewUsers();
        self.getMembers();
    };

    self.shared.refreshUsers = self.refreshUsers;
};