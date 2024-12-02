import phaseItemTemplate from "./templates/design-editor/phase-item.template.js";

const phaseItemDirective = function() {
    return {
        restrict: 'E',
        scope: {
            phase: '=',
            onSelect: '&',
        },
        template: phaseItemTemplate,
        controller: PhaseItemController,
        controllerAs: '$ctrl',
    };
};

function PhaseItemController() {
    const vm = this;

    vm.selectPhase = function() {
        vm.onSelect({ index: vm.phase.index });
    };
}

export default phaseItemDirective;