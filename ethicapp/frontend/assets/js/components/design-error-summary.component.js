const designErrorSummaryComponent = {
    bindings: {
        validationErrors: '<',
        scrollTo: '&'
    },
    template: `
<div class="panel panel-default">
    <div class="panel-heading">
        {{ 'validation_summary_title_text' | translate }}
    </div>
    <div class="panel-body">
        <div class="validation-errors" ng-if="!$ctrl.hasErrors()">
            <p>{{ 'valid_design_message' | translate }}</p>
        </div>
        <div class="validation-errors" ng-if="$ctrl.hasErrors()">
            <p>{{ 'design_error_message' | translate }}</p>
            
            <hr style="margin-bottom:1em">                     
            
            <!-- Global Errors -->
            <div ng-if="$ctrl.validationErrors.global.length > 0" class="error-section">
                <h4>{{ 'global_errors_title' | translate }}</h4>
                <ul class="list-group">
                    <li class="list-group-item" 
                        ng-repeat="error in $ctrl.validationErrors.global">
                        <span class="text-danger">{{ error | translate }}</span>
                    </li>
                </ul>
            </div>
            
            <!-- Phase Errors -->
            <div ng-repeat="phaseKey in $ctrl.getSortedPhaseErrorKeys()" class="error-section">
                <label>
                    {{ 'phase_title_prefix' | translate }} {{ phaseKey.split('_')[1] }}
                </label>
            
                <!-- Grouping Config Errors -->
                <div ng-if="$ctrl.validationErrors.phases[phaseKey].groupingConfig.length > 0">
                    <h5>{{ 'grouping_config_errors_title' | translate }}</h5>
                    <ul class="list-group">
                        <li class="list-group-item" 
                            ng-repeat="error in $ctrl.validationErrors.phases[phaseKey].groupingConfig" 
                            ng-click="$ctrl.scrollTo({ phaseKey: phaseKey })">
                            <span class="text-danger">{{ error | translate }}</span>
                        </li>
                    </ul>
                </div>
            
                <!-- Items/Questions Errors -->
                <div ng-if="$ctrl.hasItemErrors(phaseKey)">
                    <h5>{{ 'item_errors_title' | translate }}</h5>
                    <div ng-repeat="(itemKey, itemErrors) in $ctrl.validationErrors.phases[phaseKey].items track by itemKey">
                        <h6>
                            {{ 'item_title_prefix' | translate }} {{ itemKey.split('_')[1] }}
                        </h6>
                        <ul class="list-group">
                            <li class="list-group-item" 
                                ng-repeat="error in itemErrors track by $index" 
                                ng-click="$ctrl.scrollTo({ phaseKey: phaseKey })">
                                <span class="text-danger">{{ error | translate }}</span>
                            </li>
                        </ul>
                    </div>
                </div>

                <div ng-if="$ctrl.validationErrors.phases[phaseKey].phaseInstructions.length > 0">
                    <h5>{{ 'phase_instructions_title' | translate }}</h5>
                    <ul class="list-group">
                        <li class="list-group-item" 
                            ng-repeat="error in $ctrl.validationErrors.phases[phaseKey].phaseInstructions"
                            ng-click="$ctrl.scrollTo({ phaseKey: phaseKey })">
                            <span class="text-danger">{{ error | translate }}</span>
                        </li>
                    </ul>
                </div>

                <!-- Other Errors -->
                <div ng-if="$ctrl.validationErrors.phases[phaseKey].other.length > 0">
                    <h5>{{ 'other_phase_errors_title' | translate }}</h5>
                    <ul class="list-group">
                        <li class="list-group-item" 
                            ng-repeat="error in $ctrl.validationErrors.phases[phaseKey].other" 
                            ng-click="$ctrl.scrollTo({ phaseKey: phaseKey })">
                            <span class="text-danger">{{ error | translate }}</span>
                        </li>
                    </ul>
                </div>

                <hr style="margin-bottom:1em">                        
            </div>
        </div>
    </div>
</div>
    `,
    controller: function () {
        const ctrl = this;

        ctrl.hasErrors = function () {
            return (
                (ctrl.validationErrors.global && ctrl.validationErrors.global.length > 0) ||
                Object.keys(ctrl.validationErrors.phases || {}).length > 0
            );
        };

        ctrl.getSortedPhaseErrorKeys = function () {
            return Object.keys(ctrl.validationErrors.phases || {}).sort((a, b) => {
                const aIndex = parseInt(a.split('_')[1], 10);
                const bIndex = parseInt(b.split('_')[1], 10);
                return aIndex - bIndex;
            });
        };

        ctrl.hasItemErrors = function (phaseKey) {
            const phase = ctrl.validationErrors.phases[phaseKey];
            return phase && Object.keys(phase.items || {}).length > 0;
        };        
    }
};

export default designErrorSummaryComponent;
