/*eslint func-style: ["error", "expression"]*/
export let DuplicateSesModalController = ($scope, $http, $uibModalInstance, data) => {
    var vm = this;
    vm.data = data;
    vm.nses = {
        name:              vm.data.name,
        tipo:              vm.data.type,
        descr:             vm.data.descr,
        originalSesid:     vm.data.id,
        copyDocuments:     false,
        copyIdeas:         false,
        copyQuestions:     false,
        copyRubrica:       false,
        copyUsers:         false,
        copySemUnits:      false,
        copySemDocs:       false,
        copyDifferentials: false
    };

    vm.cancel = function () {
        $uibModalInstance.dismiss("cancel");
    };

    vm.sendDuplicate = function () {
        console.log(vm.nses);
        $http({ url: "duplicate-session", method: "post", data: vm.nses }).success(function (data) {
            console.log(data);
            window.location.replace("admin");
        });
    };
};