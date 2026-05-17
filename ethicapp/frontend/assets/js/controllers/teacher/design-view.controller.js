/*eslint func-style: ["error", "expression"]*/
export function DesignViewController($scope, $routeParams, DesignCatalogService) {
    const vm = this;
    vm.keyGroups = function (k1, k2) {
        return {
            key:  k1 + (k2 == null ? "" : " " + k2),
            name: k1 + (k2 == null ? "" : " " + k2)
            //name: vm.flang(k1) + (k2 == null ? "" : " " + vm.flang(k2)) FIX TRANSLATION BUG
        };
    };

    vm.currentStage = 0; //index of stage
    vm.currentQuestion = 0; //index of current question
    vm.methods = [
        vm.keyGroups("random"), vm.keyGroups("performance", "homog"),
        vm.keyGroups("performance", "heterg"), 
        vm.keyGroups("previous")
    ];

    vm.groupType = [vm.keyGroups("individual"), vm.keyGroups("team")];
    vm.busy = false; //upload file
    vm.extraOpts = false;
    vm.prevStages = false;
    vm.error = false;
    vm.saved = false;
    vm.errorList = [];
    vm.designObj = null;
    vm.designId = 0;
    vm.selectedOption = "";
    vm.roles = [];

    vm.keyGroups = function (k1, k2) {
        return {
            key:  k1 + (k2 == null ? "" : " " + k2),
            name: k1 + (k2 == null ? "" : " " + k2)
        };
    };

    vm.methods = [
        vm.keyGroups("random"), vm.keyGroups("performance", "homog"),
        vm.keyGroups("performance", "heterg"), 
        vm.keyGroups("previous")
    ];

    vm.groupType = [vm.keyGroups("individual"), vm.keyGroups("team")];

    vm.init = async function() {        
        try {
            if (!("id" in $routeParams)) {
                throw new Error("No id route parameter given.");
            }
            
            vm.designId = Number($routeParams.id);
            vm.designObj = await DesignCatalogService.getDesignById(vm.designId);

            if (vm.designObj === null) {
                throw new Error("Design object not found.");
            }

            vm.stageType = vm.designObj.type;
            if(vm.designObj.type == "semantic_differential") {
                vm.num = vm.designObj.phases[0].questions[0].ans_format.values;
            }

            $scope.$applyAsync();
        }
        catch (error) {
            console.error("[DesignViewController::init] " + error);
            $scope.navigateTo("/error/404/2");
        }
    }

    vm.toggleOpts = function(opt){
        if(opt == 1) {
            vm.extraOpts = !vm.extraOpts;
        }
        else if(opt == 2) {
            vm.prevStages = !vm.prevStages;
        }
    };

    vm.buildArray = function(n) {
        let a = [];
        for (let i = 1; i <= n; i++) {
            a.push(i);
        }
        return a;
    };
    
    vm.selectQuestion = function(id){
        vm.currentQuestion = id; 
        vm.num = vm.designObj.phases[vm.currentStage].questions[vm.currentQuestion].ans_format
            .values;
    };

    vm.selectStage = function(id){
        if (vm.currentStage != id) {
            vm.currentStage = id;
            vm.stageType = vm.designObj.type;
            vm.currentQuestion = 0;
            if (vm.stageType == "semantic_differential") {  
                vm.num = vm.designObj.phases[vm.currentStage].questions[vm.currentQuestion]
                    .ans_format.values;
            }
        }
        vm.extraOpts = false;
        vm.prevStages = false;
    };

    vm.getStages = function() {
        if (vm.designObj == null) {
            return [];
        }    
        return vm.designObj.phases;
    };

    vm.init();
}
