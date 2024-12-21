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
        let validation = { 
            type: "phase",
            valid: true, 
            context: 
                {
                    phaseNumber: vm.phaseIndex + 1,
                    groupingConfig: true,
                },
            messages: []
        };
    
        // Rule 0: If the phase's mode is "team", then a grouping method must be selected
        if (vm.phase.mode === 'team' && (vm.selectedMode == '' || vm.selectedMode == null)) {
            validation.valid = false;
            validation.messages.push("error_must_select_grouping_algorithm");            
        }

        // Rule 1: 'preserve' is not valid in the first phase
        if (vm.selectedMode === 'preserve' && vm.phaseIndex === 0) {
            validation.valid = false;
            validation.messages.push("error_cannot_preserve_groups_phase1");
        }
    
        // Rule 2: 'preserve' is valid only if there is a previous team phase with a grouping algorithm defined
        if (vm.selectedMode === 'preserve') {
            const hasValidPreviousGrouping = vm.design.phases
                .slice(0, vm.phaseIndex) // Consider only phases before the current one
                .some(phase => phase.mode === 'team' && phase.grouping_algorithm); // Check for team mode with a grouping algorithm
    
            if (!hasValidPreviousGrouping) {
                validation.valid = false;
                validation.messages.push("error_no_previous_grouping");
            }
        }

        // Return the validation result
        return validation;
    };
    
    vm.updateGroupingMode = function () {
        vm.phase.grouping_algorithm = vm.selectedMode;

        if (vm.validateCallback) {
            const validation = vm.validate();
            vm.validateCallback({ result: validation });
        }
    };

    vm.validate = function () {
        return vm.isValidMode();
        /*if (!validation.valid) {
            return validation;
        }
        return { valid: true };*/
    };

    vm.$onInit = function () {
        vm.loadGroupingModes();
    
        // Set the selected mode based on the phase's grouping_algorithm
        if (vm.phase && vm.phase.grouping_algorithm) {
            const validMode = vm.groupingModes.some(mode => mode.name === vm.phase.grouping_algorithm);
            vm.selectedMode = validMode ? vm.phase.grouping_algorithm : null;
    
            if (!validMode) {
                console.warn(`[GroupingModeSelectorController] Invalid grouping_algorithm '${vm.phase.grouping_algorithm}' in phase. Resetting to null.`);
            }
        } else {
            // Default to null if no grouping_algorithm is set
            vm.selectedMode = null;
        }
    
        // Perform initial validation
        if (vm.validateCallback) {
            const validation = vm.validate();
            vm.validateCallback({ result: validation });
        }        
    };

    vm.$onDestroy = function() {
        console.log(`[GroupingModeSelectorController] on destroy`);
        vm.selectedMode = null;
        if (vm.validateCallback) {
            const validation = vm.validate();
            vm.validateCallback({ result: validation });
        }
    }

    vm.$onChanges = function (changes) {
        console.log(`[GroupingModeSelectorController] something changed`);
        if (changes.phase && changes.phase.currentValue) {
            const currentMode = changes.phase.currentValue.mode;
            const previousMode = changes.phase.previousValue
                ? changes.phase.previousValue.mode
                : undefined;
            console.log(`[GroupingModeSelectorController] mode changed`);

            if (currentMode === 'individual') {
                console.log(`[GroupingModeSelectorController] mode changed to individual`);
                vm.selectedMode = null;
                
                if (vm.validateCallback) {
                    const validation = vm.validate();
                    vm.validateCallback({ result: validation });
                }                    
            }
        }
    };    
};

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
        <select id="groupingMode" 
                class="form-control" 
                ng-class="{'input-warning': !$ctrl.isValidMode().valid}" 
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

GroupingModeSelectorController.$inject = ['$http'];

export default groupingModeSelectorComponent;