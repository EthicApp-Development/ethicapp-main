const phaseDeleterDirective = function ($translate) {
    return {
        restrict: 'A',
        scope: {
            phases: '=',
            phaseIndex: '<',
            onDelete: '&?',
        },
        link: function (scope, element) {
            element.on('click', function (event) {
                event.preventDefault();
                event.stopPropagation();

                $translate('delete_phase_confirmation_message').then(function (confirmationMessage) {
                    if (window.confirm(confirmationMessage)) {
                        scope.$applyAsync(function () {
                            
                            scope.phases.splice(scope.phaseIndex, 1);

                            if (scope.onDelete) {
                                scope.onDelete({ index: scope.phaseIndex });
                            }
                        });
                    }
                });
            });

            scope.$on('$destroy', function () {
                element.off('click');
            });
        },
    };
};

phaseDeleterDirective.$inject = ['$translate'];
export default phaseDeleterDirective;
