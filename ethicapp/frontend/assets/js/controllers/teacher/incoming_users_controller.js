/*eslint func-style: ["error", "expression"]*/
export let IncomingUsersController = ($scope, $http, ActivityStateService,
    Notification) => {
    var self = $scope;

    self.addToSession = function () {
        if (self.newMembs.length === 0) {
            Notification.error("No hay usuarios seleccionados para agregar");
            return;
        }
        var postdata = {
            users: self.newMembs.map(function (e) {
                return e.id;
            }),
            sesid: ActivityStateService.sessionDescriptor.id
        };
        $http({ url: "add-ses-users", method: "post", data: postdata })
            .then(function (response) {
                if (response.data.status === "ok") {
                    self.refreshUsers();
                }
            })
            .catch(function (error) {
                console.error("Error adding users to session:", error);
            });
    };
    
    self.removeUser = function (uid) {
        if (ActivityStateService.sessionDescriptor.status <= 2) {
            var postdata = { uid: uid, sesid: ActivityStateService.sessionDescriptor.id };
            $http({ url: "delete-ses-user", method: "post", data: postdata })
                .then(function (response) {
                    if (response.data.status === "ok") {
                        self.refreshUsers();
                    }
                })
                .catch(function (error) {
                    console.error("Error removing user from session:", error);
                });
        }
    };
    
    self.refreshUsers = function () {
        self.getNewUsers();
        self.getMembers();
    };

    self.shared.refreshUsers = self.refreshUsers;
};