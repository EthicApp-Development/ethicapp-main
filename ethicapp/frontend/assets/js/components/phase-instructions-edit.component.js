function PhaseInstructionsEditController() {
    const vm = this;

    vm.isInstructionsEnabled = false;

    vm.syncStateFromPhase = function () {
        vm.isInstructionsEnabled = typeof vm.phase.instructions === 'string';
    };

    vm.toggleInstructions = function () {
        if (vm.isInstructionsEnabled) {
            vm.phase.instructions = vm.phase.instructions || '';
            return;
        }

        delete vm.phase.instructions;
    };

    vm.isInstructionsInvalid = function () {
        if (!vm.isInstructionsEnabled) {
            return false;
        }

        return typeof vm.phase.instructions !== 'string' || vm.phase.instructions.trim().length === 0;
    };

    vm.$onInit = function () {
        vm.syncStateFromPhase();
    };

    vm.$onChanges = function (changes) {
        if (changes.phase && changes.phase.currentValue) {
            vm.syncStateFromPhase();
        }
    };
}

const phaseInstructionsEditComponent = {
    bindings: {
        phase: '<',
        phaseIndex: '<'
    },
    template: `
    <div>
        <hr style="margin-top: 1.5em; margin-bottom: 1.25em">
        <h4>{{ 'phase_instructions_title' | translate }}</h4>
        <input
            type="checkbox"
            id="phase_instructions_enabled_{{$ctrl.phaseIndex}}"
            ng-model="$ctrl.isInstructionsEnabled"
            ng-change="$ctrl.toggleInstructions()">
        <label for="phase_instructions_enabled_{{$ctrl.phaseIndex}}">
            {{ 'phase_instructions_enabled_label' | translate }}
        </label>

        <div style="margin-top: 0.5em" ng-if="$ctrl.isInstructionsEnabled">
            <textarea
                id="phase_instructions_text_{{$ctrl.phaseIndex}}"
                class="form-control"
                ng-class="{'input-warning': $ctrl.isInstructionsInvalid()}"
                rows="3"
                ng-model="$ctrl.phase.instructions"
                placeholder="{{ 'phase_instructions_placeholder' | translate }}">
            </textarea>
        </div>
    </div>
    `,
    controller: PhaseInstructionsEditController
};

export default phaseInstructionsEditComponent;
