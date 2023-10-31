/*eslint func-style: ["error", "expression"]*/
export let OptionsController = ($scope, $http, Notification) => {
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
            sesid:   self.selectedSes.id,
            options: self.buildConfStr()
        };
        $http.post("update-ses-options", postdata).success(function (data) {
            if (data.status == "ok") {
                Notification.success("Opciones actualizadas");
                self.selectedSes.options = postdata.options;
                self.selectedSes.conf = null;
                self.shared.updateConf();
            }
        });
    };

    self.shared.saveConfs = self.saveConfs;

    self.shared.updateConf = function () {
        if (self.selectedSes.conf == null) {
            self.selectedSes.conf = {};
            var op = self.selectedSes.options || "";
            for (var i = 0; i < op.length; i++) {
                self.selectedSes.conf[op[i]] = true;
            }
            //console.log(self.selectedSes);
        }
        return true;
    };

    self.buildConfStr = function () {
        var s = "";
        for (var key in self.selectedSes.conf) {
            if (self.selectedSes.conf[key]) s += key;
        }
        return s;
    };
};