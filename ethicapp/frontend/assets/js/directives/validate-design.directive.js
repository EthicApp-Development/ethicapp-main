const validateDesignDirective = function () {
    return {
        restrict: 'A',
        scope: {
            phases: '=',
            onValidate: '&'
        },
        link: function (scope) {
            function validatePhases() {
                if (!scope.phases || scope.phases.length === 0) {
                    const result = {
                        type: 'global',
                        valid: false,
                        messages: ['error_no_phases_defined']
                    };
                    scope.onValidate({ result });
                    console.warn('[validateDesignDirective] No phases defined.');
                } else {
                    const result = {
                        type: 'global',
                        valid: true,
                        messages: []
                    };
                    scope.onValidate({ result });
                    console.log('[validateDesignDirective] Validation passed.');
                }
            }

            scope.$watch('phases', function (newVal, oldVal) {
                validatePhases();
            }, true);

            validatePhases();
        }
    };
};

export default validateDesignDirective;
