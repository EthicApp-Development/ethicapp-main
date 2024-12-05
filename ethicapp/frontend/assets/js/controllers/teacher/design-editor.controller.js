import designEditActions from "../../helpers/phase-edition-helpers.js";
import { getPhaseByIndex } from "../../helpers/design-helpers.js";

export function DesignEditorController($scope, $routeParams, 
    DesignStateService, DesignCatalogService) {

    const vm = this;
    vm.designId = 0;
    vm.design = null;
    vm.message = "Testing the scope!";
    vm.accordionState = {};

    vm.init = async function() {
        // Retrieve the design from the route path
        if ($routeParams.id !== undefined) {

            const designId = Number($routeParams.id);
            vm.designId = designId;

            const designObj = await DesignCatalogService.getDesignById(designId);
            vm.design = designObj;

            if (designObj === null) {
                console.error("[DesignEditorController::init] Design not found.");
                $scope.navigateTo("/error/404/2");
            }

            // Ensure the design is properly digested
            $scope.$applyAsync(() => {
                vm.design = designObj;
            });

            await DesignStateService.setDesign(designId, designObj);

            vm.initializeAccordionStates();
        }
    };

    vm.initializeAccordionStates = function () {
        vm.accordionState = {};
        try {
            vm.design.phases.forEach((_, index) => {
                vm.accordionState[index] = true;
            });
        } catch (error) {
            console.warn("The design does not appear to have any phases yet.");
        }
    };

    vm.toggleAccordionState = function (index, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        vm.accordionState[index] = !vm.accordionState[index];
    };

    vm.addPhase = function() { 
        console.log("[addPhase] " + JSON.stringify(vm.design));
        const phase = designEditActions.buildBlankPhase(vm.design);
        $scope.$applyAsync(() => {
            designEditActions.addPhase(vm.design, phase);
        });
    };

    vm.addItemToPhase = function(phase) {
        const item = designEditActions.buildBlankItem(vm.design);
        $scope.$applyAsync(() => {
            designEditActions.addPhaseItem(vm.design, phase, item);
        });
    };

    vm.duplicatePhase = function(phaseIndex, event = null) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        $scope.$applyAsync(() => {
            designEditActions.clonePhaseByIndex(vm.design, phaseIndex);
        });
    };

    vm.removeItemFromPhase = function(phase, item) {
        designEditActions.removePhase(vm.design, phase, item);
    };

    vm.toggleAccordion = function (index) {
        console.log("toggleAccordion");
        vm.accordionState[index] = !vm.accordionState[index];
    };

    vm.isAccordionOpen = function (index) {
        console.log("isAccordionOpen");
        return vm.accordionState[index] || false;
    };  

    vm.confirmDeletePhase = function (index, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        if (window.confirm("¿Estás seguro de que deseas eliminar esta fase?")) {
            const phase = getPhaseByIndex(vm.design, index)
            designEditActions.removePhase(vm.design, phase);
            delete vm.accordionState[index];
        }
    };

    vm.saveDesign = async function() {
        try {
            if (vm.design == null) {
                throw Error("Cannot save a null design");
            }
            await DesignCatalogService.updateDesign(vm.designId, vm.design);
        }
        catch (error) {
            // TODO: display error on view.
            console.error(error);
        }
    };

    vm.init();
}