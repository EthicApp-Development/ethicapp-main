let phaseStateDirective = function() {
    return {
        restrict: 'E',
        scope: {
            phaseConfig: '<', 
            users: '<',       
            responses: '<'    
        },
        template: `
            <div>
                <h5>{{ phaseConfig.name | translate }}</h5>
                <div ng-if="!phaseConfig.isGroup">
                    <individual-phase-table
                        phase-config="phaseConfig"
                        users="users"
                        responses="responses">
                    </individual-phase-table>
                </div>
                <div ng-if="phaseConfig.isGroup">
                    <group-phase-table
                        phase-config="phaseConfig"
                        users="users"
                        responses="responses">
                    </group-phase-table>
                </div>
            </div>
        `
    };
};

export { phaseStateDirective };