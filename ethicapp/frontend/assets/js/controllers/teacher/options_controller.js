/*eslint func-style: ["error", "expression"]*/
export let OptionsController = ($scope, $http, Notification, ActivityStateService) => {
    var self = $scope;
    self.conf = {};
    self.sesidConfig = -1;
    self.options = [
        { name: "optCom", code: "J" },
        { name: "optConfLv", code: "C" },
        { name: "optHint", code: "H" }
    ];

    self.saveConfs = function () {
        var postdata = {
            sesid:   ActivityStateService.sessionDescriptor.id,
            options: self.buildConfStr()
        };
        $http.post("update-ses-options", postdata)
        .then(function (response) {
            if (response.data.status === "ok") {
                Notification.success("Opciones actualizadas");
                ActivityStateService.sessionDescriptor.options = postdata.options;
                ActivityStateService.sessionDescriptor.conf = null;
                self.shared.updateConf();
            }
        })
        .catch(function (error) {
            console.error("Error updating session options:", error);
        });
    
    };

    self.shared.saveConfs = self.saveConfs;

    self.shared.updateConf = function () {
        if (ActivityStateService.sessionDescriptor.conf == null) {
            ActivityStateService.sessionDescriptor.conf = {};
            var op = ActivityStateService.sessionDescriptor.options || "";
            for (var i = 0; i < op.length; i++) {
                ActivityStateService.sessionDescriptor.conf[op[i]] = true;
            }
        }
        return true;
    };

    self.buildConfStr = function () {
        var s = "";
        for (var key in ActivityStateService.sessionDescriptor.conf) {
            if (ActivityStateService.sessionDescriptor.conf[key]) s += key;
        }
        return s;
    };
};