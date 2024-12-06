let phaseMoverComponent = {
    bindings: {
        phases: '<',
        index: '<',
    },
    controller: PhaseMoverController,
    template: `
        <hr style="margin-top:1em">
        <div class="phase-mover" style="margin-top: 1em; margin-left: 1em">
            <i ng-if="!$ctrl.isFirstPhase()" 
               class="fa-solid fa-caret-up" 
               style="cursor: pointer; font-size:1.25em;" 
               ng-click="$ctrl.moveUp();">
            </i>
            <i ng-if="!$ctrl.isLastPhase()" 
               class="fa-solid fa-caret-down" 
               style="cursor: pointer; font-size:1.25em;" 
               ng-click="$ctrl.moveDown()">
            </i>
        </div>`,
};

function PhaseMoverController() {
    const vm = this;

    vm.moveUp = function () {
        if (vm.index > 0) {
            const temp = vm.phases[vm.index];
            vm.phases[vm.index] = vm.phases[vm.index - 1];
            vm.phases[vm.index - 1] = temp;
        }
    };

    vm.moveDown = function () {
        if (vm.index < vm.phases.length - 1) {
            const temp = vm.phases[vm.index];
            vm.phases[vm.index] = vm.phases[vm.index + 1];
            vm.phases[vm.index + 1] = temp;
        }
    };

    vm.isFirstPhase = function () {
        return vm.index === 0;
    };

    vm.isLastPhase = function () {
        return vm.index === vm.phases.length - 1;
    };
}

export default phaseMoverComponent;