/*eslint func-style: ["error", "expression"]*/
export let EthicsModalController = function($scope, $http, $uibModalInstance, Notification, data) {
    self = $scope;
    var vm = this;
    vm.data = data;
    vm.isAnon = true;

    vm.cancel = function () {
        $uibModalInstance.dismiss("cancel");
    };

    vm.shareDetails = function () {
        if (!vm.isAnon) {
            Notification.error("Sólo se pueden enviar diferenciales en forma anónima");
            return;
        }
        var content = document.getElementById("details-modal")
            .innerHTML.replace(/<\!--.*?-->/g, "");
        var postdata = {
            sesid:   vm.data.sesid,
            content: content
        };
        $http({ url: "broadcast-diff", method: "post", data: postdata }).success(function () {
            Notification.success("Diferencial enviado exitosamente");
        });
    };
};