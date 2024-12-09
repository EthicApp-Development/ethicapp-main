const phaseMoverComponent = {
    bindings: {
        phases: '<',
        index: '<',
        onMove: '&?',
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

    vm.isFirstPhase = function () {
        return vm.index === 0;
    };

    vm.isLastPhase = function () {
        return vm.index === vm.phases.length - 1;
    };

    vm.moveUp = function () {
        if (vm.index > 0) {
            swapPhases(vm.phases, vm.index, vm.index - 1);

            if (vm.onMove) {
                vm.onMove({ fromIndex: vm.index, toIndex: vm.index - 1 });
            }
        }
    };

    vm.moveDown = function () {
        if (vm.index < vm.phases.length - 1) {
            swapPhases(vm.phases, vm.index, vm.index + 1);

            if (vm.onMove) {
                vm.onMove({ fromIndex: vm.index, toIndex: vm.index + 1 });
            }
        }
    };

    function swapPhases(phases, fromIndex, toIndex) {
        const temp = phases[fromIndex];
        phases[fromIndex] = phases[toIndex];
        phases[toIndex] = temp;
    }
}

export default phaseMoverComponent;