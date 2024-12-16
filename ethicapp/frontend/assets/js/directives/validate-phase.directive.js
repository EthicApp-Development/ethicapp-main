const watchObjects = {
    semantic_differential: 'phase.questions',
    ranking: 'phase.roles'
};

const itemValidators = {
    semantic_differential : function(scope, phaseNumber) {
        console.log("[validatePhaseDirective] semantic_differential validator");
        const phase = scope.phase;
        if (!phase.questions || phase.questions.length === 0) {
            const result = {
                type: 'phase',
                context: {
                    phaseNumber: phaseNumber
                },                
                messages: ['error_no_items_defined']
            };
            scope.onValidate({ result });
            console.warn('[validatePhaseDirective] No items defined.');
        } else {
            const result = {
                type: 'phase',
                context: {
                    phaseNumber: phaseNumber
                },                
                messages: []
            };
            scope.onValidate({ result });
            console.log('[validatePhaseDirective] Validation passed.');
        }
    },
    ranking : function(scope, phaseNumber) {
        const phase = scope.phase;
        if (!phase.roles || phase.roles.length === 0) {
            const result = {
                type: 'phase',
                context: {
                    phaseNumber: phaseNumber
                },
                messages: ['error_no_items_defined']
            };
            scope.onValidate({ result });
            console.warn('[validatePhaseDirective] No roles defined.');
        } else {
            const result = {
                type: 'phase',
                context: {
                    phaseNumber: phaseNumber
                },
                messages: []
            };
            scope.onValidate({ result });
            console.log('[validatePhaseDirective] Validation passed.');
        }
    }
}

const validatePhaseDirective = function () {
    return {
        restrict: 'A',
        scope: {
            designType: '<',
            phaseNumber: '<',
            phase: '=',
            onValidate: '&'
        },
        link: function (scope) {
            const watchObject = watchObjects[scope.designType];
            if (!watchObject) {
                console.error("Unsupported design type");
                return;
            }
            
            const validator = itemValidators[scope.designType];
            if (!validator) {
                console.error("Unsupported design type");
                return;
            }

            scope.$watch(watchObject, function (newVal, oldVal) {
                validator(scope, scope.phaseNumber);
            }, true);

            validator(scope, scope.phaseNumber);
        }
    };
};

export default validatePhaseDirective;
