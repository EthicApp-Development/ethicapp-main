export let ShowErrorsDirective = () => {
    return {
        restrict: 'A',
        require: 'ngModel',
        scope: {
        errorMessage: '@'
        },
        link: function(scope, element, attrs, ngModelCtrl) {
        var errorElement = angular.element('<span class="error-message"></span>');
        errorElement.text(scope.errorMessage);
        element.after(errorElement);
    
        errorElement.css('display', 'none');
    
        scope.$watch(function() {
            return ngModelCtrl.$invalid && (ngModelCtrl.$touched || ngModelCtrl.$dirty);
        }, function(showError) {
            if (showError) {
            errorElement.css('display', 'block');
            } else {
            errorElement.css('display', 'none');
            }
        });
        }
    };
}