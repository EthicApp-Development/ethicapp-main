const groupingModeSelectorComponent = {
    bindings: {
        phase: '<',
    },
    template: `
    <div class="grouping-mode-selector" ng-show="$ctrl.isTeamMode()">
        <div class="form-group">
            <label for="groupingMode">
                {{ 'grouping_mode_label_text' | translate }}
            </label>
            <select id="groupingMode" class="form-control grouping-mode"
                    ng-model="$ctrl.selectedMode"
                    ng-options="mode.name as (mode.description | translate) for mode in $ctrl.groupingModes"
                    ng-change="$ctrl.updateGroupingMode()">
                <option value="">{{ 'no_grouping_mode_selected_text' | translate }}</option>
            </select>
        </div>
    </div>
    `,
    controller: GroupingModeSelectorController,
};

function GroupingModeSelectorController($http) {
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

    vm.isTeamMode = function () {
        return vm.phase.mode === 'team';
    };

    vm.updateGroupingMode = function () {
        vm.phase.grouping_algorithm = vm.selectedMode;
    };

    vm.$onInit = function () {
        vm.loadGroupingModes();
    };
}

GroupingModeSelectorController.$inject = ['$http'];

export default groupingModeSelectorComponent;