let phaseStateDirective = function() {
    return {
        restrict: 'E',
        scope: {
            designType: '<',
            phaseData: '<',
            // The dashboard's participant search (#894): the tables show
            // the rows whose participant's name contains it.
            participantQuery: "<?",
            // The text of each question, which the column headers show on
            // hover and focus (#895).
            questionTexts:    "<?",
            onSelectResponse: '&?',
            onSelectGroup: '&?'
        },
        bindToController: true,
        controllerAs: 'ctrl',
        controller: function() {
            const ctrl = this;
            ctrl.$onChanges = function(changes) {
                if (changes.designType) {
                    // console.debug('[phaseStateDirective] DesignType changed:', changes.designType.currentValue);
                    ctrl.designType = changes.designType.currentValue;
                }
                if (changes.phaseData) {
                    // console.debug('[phaseStateDirective] PhaseData changed:', changes.phaseData.currentValue);
                    ctrl.phaseData = changes.phaseData.currentValue;
                }
            };

            ctrl.$onInit = function() {
                // console.debug('[phaseStateDirective] Initialized');
            };
        },
        templateUrl: "/assets/static/views/teacher/fragments/phase-state.template.html"
    };
};

export { phaseStateDirective };
