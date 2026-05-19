const watchObjects = {
    semantic_differential: ['phase.questions', 'phase.instructions'],
    ranking: ['phase.roles', 'phase.instructions']
};

const itemValidators = {
    semantic_differential : function(scope, phaseNumber) {
        // console.debug("[validatePhaseDirective] semantic_differential validator");
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
            // console.debug('[validatePhaseDirective] Validation passed.');
        }

        validatePhaseInstructions(scope, phaseNumber);
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
            // console.warn('[validatePhaseDirective] No roles defined.');
        } else {
            const result = {
                type: 'phase',
                context: {
                    phaseNumber: phaseNumber
                },
                messages: []
            };
            scope.onValidate({ result });
            // console.debug('[validatePhaseDirective] Validation passed.');
        }

        validatePhaseInstructions(scope, phaseNumber);
    }
}

function validatePhaseInstructions(scope, phaseNumber) {
    const phase = scope.phase;
    const hasInstructionsField = Object.prototype.hasOwnProperty.call(phase, 'instructions');
    const hasValidInstructions = typeof phase.instructions === 'string' && phase.instructions.trim().length > 0;
    const messages = hasInstructionsField && !hasValidInstructions
        ? ['error_phase_instructions_required']
        : [];

    const result = {
        type: 'phase',
        context: {
            phaseNumber: phaseNumber,
            phaseInstructions: true
        },
        messages
    };

    scope.onValidate({ result });
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

            if (Array.isArray(watchObject)) {
                watchObject.forEach((path) => {
                    scope.$watch(path, function () {
                        // console.debug(`[validatePhaseDirective] Watching ${path}`);
                        validator(scope, scope.phaseNumber);
                    }, true);
                });
            } else {
                scope.$watch(watchObject, function () {
                    // console.debug(`[validatePhaseDirective] Watching ${watchObject}`);
                    validator(scope, scope.phaseNumber);
                }, true);
            }

            validator(scope, scope.phaseNumber);
        }
    };
};

export default validatePhaseDirective;
