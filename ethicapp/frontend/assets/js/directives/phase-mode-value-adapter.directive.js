const phaseModeValueAdapter = function() {
    return {
        restrict: 'A',
        require: 'ngModel',
        link: function(scope, element, attrs, ngModelCtrl) {
            ngModelCtrl.$formatters.push(function(modelValue) {
                return modelValue === 'team';
            });

            ngModelCtrl.$parsers.push(function(viewValue) {
                return viewValue ? 'team' : 'individual';
            });
        }
    };
};
export default phaseModeValueAdapter;
