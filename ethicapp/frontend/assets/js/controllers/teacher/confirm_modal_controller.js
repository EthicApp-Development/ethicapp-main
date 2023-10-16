export let ConfirmModalController = function($uibModalInstance){
    var vm = this;

    vm.ok = function () {
        $uibModalInstance.close();
    };

    vm.cancel = function () {
        $uibModalInstance.dismiss("cancel");
    };
};