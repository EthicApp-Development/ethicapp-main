/*eslint func-style: ["error", "expression"]*/
export let ContentModalController = ($scope, $uibModalInstance, data) => {
    var vm = this;
    vm.data = data;

    vm.cancel = function () {
        $uibModalInstance.dismiss("cancel");
    };
};