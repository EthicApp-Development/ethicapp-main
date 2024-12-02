export function DirectContentController($scope, $uibModalInstance, data) {
    var vm = this;
    vm.data = data;
    vm.data.title = "Diferencial recibido";

    setTimeout(function () {
        document.getElementById("modal-content").innerHTML = vm.data.content;
    }, 500);

    vm.cancel = function () {
        $uibModalInstance.dismiss("cancel");
    };
};