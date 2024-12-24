let phaseStateDirective = function() {
    return {
        restrict: 'E',
        scope: {
            designType: '<',
            phaseData: '<'
        },
        bindToController: true,
        controllerAs: 'ctrl',
        controller: function() {
            const ctrl = this;
            // Detecta cambios en las bindings
            ctrl.$onChanges = function(changes) {
                if (changes.designType) {
                    console.debug('[phaseStateDirective] DesignType changed:', changes.designType.currentValue);
                    ctrl.designType = changes.designType.currentValue;
                }
                if (changes.phaseData) {
                    console.debug('[phaseStateDirective] PhaseData changed:', changes.phaseData.currentValue);
                    ctrl.phaseData = changes.phaseData.currentValue;
                }
            };

            ctrl.$onInit = function() {
                console.debug('[phaseStateDirective] Initialized');
            };
        },
        templateUrl: "/assets/static/partials/teacher/micro-partials/phase-state.template.html"
    };
};

export { phaseStateDirective };