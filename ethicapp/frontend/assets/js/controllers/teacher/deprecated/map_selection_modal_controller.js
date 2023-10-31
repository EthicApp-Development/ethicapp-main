/*eslint func-style: ["error", "expression"]*/
export let MapSelectionModalController = ($scope, $uibModalInstance) => {
    var vm = this;

    vm.nav = true;
    vm.edit = false;

    vm.cancel = function () {
        $uibModalInstance.dismiss("cancel");
    };

    vm.resolve = function () {
        $uibModalInstance.close({
            nav:  vm.nav,
            edit: vm.edit
        });
    };
};