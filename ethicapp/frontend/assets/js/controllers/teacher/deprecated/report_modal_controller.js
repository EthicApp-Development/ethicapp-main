/*eslint func-style: ["error", "expression"]*/
export let report_modal_controller = ($scope, $uibModalInstance, data) => {
    var vm = this;
    vm.data = data;

    vm.cancel = function () {
        $uibModalInstance.dismiss("cancel");
    };
};