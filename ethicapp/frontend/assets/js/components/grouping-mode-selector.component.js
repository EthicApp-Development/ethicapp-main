const groupingModeSelectorComponent = {
    bindings: {
        phase: '<',         
        phaseIndex: '<',    
        design: '<',        
        validateCallback: '&?',
    },
    template: `
    <div class="grouping-mode-selector">
        <label for="groupingMode">{{ 'grouping_mode_label_text' | translate }}</label>
        <select id="groupingMode" class="form-control"
                ng-model="$ctrl.selectedMode"
                ng-options="mode.name as (mode.description | translate) for mode in $ctrl.groupingModes"
                ng-change="$ctrl.updateGroupingMode()">
            <option value="">{{ 'no_grouping_mode_selected_text' | translate }}</option>
        </select>
        <div class="error-message" ng-if="!$ctrl.isValidMode().valid && $ctrl.selectedMode === 'preserve'">
            <span class="text-danger">{{ $ctrl.isValidMode().message | translate }}</span>
        </div>
    </div>
    `,
    controller: GroupingModeSelectorController,
};

function GroupingModeSelectorController() {
    const vm = this;

    vm.groupingModes = [];
    vm.selectedMode = null;

    /*vm.loadGroupingModes = function () {
    $http.get('/groups/available-grouping-modes')
        .then(response => {
            vm.groupingModes = response.data.available_grouping_modes;
        })
        .catch(error => {
            console.error('Error al cargar los modos de agrupación:', error);
        });
    };*/

    vm.loadGroupingModes = function () {
        vm.groupingModes = [
            { name: 'random', description: 'random_groups_description_text' },
            { name: 'preserve', description: 'preserve_groups_description_text' },
        ];
    };

    vm.isValidMode = function () {
        // Rule 1: 'preserve' is not valid in the first phase
        if (vm.selectedMode === 'preserve' && vm.phaseIndex === 0) {
            return { 
                valid: false,
                message: "error_cannot_preserve_groups_phase1"
            };
        }
    
        // Rule 2: 'preserve' is valid only if there is a previous team phase with a grouping algorithm defined
        if (vm.selectedMode === 'preserve') {
            const hasValidPreviousGrouping = vm.design.phases
                .slice(0, vm.phaseIndex) // Consider only phases before the current one
                .some(phase => phase.mode === 'team' && phase.grouping_algorithm); // Check for team mode with a grouping algorithm
    
            return { 
                valid: hasValidPreviousGrouping,
                message: !hasValidPreviousGrouping ? "error_no_previous_grouping" : ""
            };
        }
    
        // All other modes are considered valid
        return { valid: true };
    };    

    vm.updateGroupingMode = function () {
        vm.phase.grouping_algorithm = vm.selectedMode;

        if (vm.validateCallback) {
            const validation = vm.validate();
            vm.validateCallback({ result: validation });
        }
    };

    vm.validate = function () {
        const validation = vm.isValidMode();
        if (!validation.valid) {
            return {
                valid: validation.valid,
                message: validation.message,
            };
        }
        return { valid: true };
    };

    vm.$onInit = function () {
        vm.loadGroupingModes();
    };
}

GroupingModeSelectorController.$inject = ['$http'];

export default groupingModeSelectorComponent;