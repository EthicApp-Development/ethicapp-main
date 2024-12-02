let phaseStateDirective = function() {
    return {
        restrict: 'E',
        scope: {
            designType: '<',
            phaseData: '<'
        },
        template: `
            <div>
                <h5>{{ "phase_title_text" | translate }} {{ phaseData.descriptor.number }}</h5>
                <div ng-if="phaseData.descriptor.mode == 'team'">
                    <individual-phase-table phase-data="phaseData" design-type="designType">
                    </individual-phase-table>
                </div>
                <div ng-if="phaseObj.descriptor.mode == 'team'">
                    <group-phase-table phase-data="phaseData" design-type="designType">
                    </group-phase-table>
                </div>
            </div>
        `
    };
};

export { phaseStateDirective };