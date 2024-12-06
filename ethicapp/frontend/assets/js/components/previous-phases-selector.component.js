const previousPhasesSelectorComponent = {
    bindings: {
        phase: '<',
        phaseIndex: '<',
        design: '<'
    },
    template: `
    <div class="prev-phases-selector" ng-if="$ctrl.availablePhases.length > 0">
        <label>{{ 'show_previous_phase_responses_text' | translate }}</label>
        <div class="phases-container">
            <div class="phase-item" ng-repeat="phase in $ctrl.availablePhases track by phase">
                <input type="checkbox" 
                    id="phase_{{phase}}" 
                    ng-checked="$ctrl.isPhaseSelected(phase)" 
                    ng-click="$ctrl.togglePhase(phase)">
                <label for="phase_{{phase}}">
                    {{ 'phase_title_prefix' | translate }} {{ phase }}
                </label>
            </div>
        </div>
    </div>
    `,
    controller: PreviousPhasesSelectorController
};

function PreviousPhasesSelectorController() {
    const vm = this;

    vm.availablePhases = [];

    vm.updateAvailablePhases = function () {
        vm.availablePhases = Array.from({ length: vm.phaseIndex }, (_, i) => i + 1);
        vm.cleanInvalidSelections();
    };

    vm.cleanInvalidSelections = function () {
        if (!Array.isArray(vm.phase.prevPhasesResponse)) {
            vm.phase.prevPhasesResponse = [];
        }
        vm.phase.prevPhasesResponse = vm.phase.prevPhasesResponse.filter(phase =>
            vm.availablePhases.includes(phase)
        );
    };
    

    vm.isPhaseSelected = function (phase) {
        return vm.phase.prevPhasesResponse.includes(phase);
    };

    vm.togglePhase = function (phase) {
        if (vm.isPhaseSelected(phase)) {
            vm.phase.prevPhasesResponse = vm.phase.prevPhasesResponse.filter(p => p !== phase);
        } else {
            vm.phase.prevPhasesResponse.push(phase);
        }
    };

    vm.$onInit = function () {
        if (!vm.phase.prevPhasesResponse) {
            vm.phase.prevPhasesResponse = [];
        }
        vm.updateAvailablePhases();
    };

    vm.$onChanges = function (changes) {
        if (changes.phase) {
            if (!vm.phase.prevPhasesResponse) {
                vm.phase.prevPhasesResponse = [];
            }
            vm.updateAvailablePhases();
        }
    };
}

export default previousPhasesSelectorComponent;
