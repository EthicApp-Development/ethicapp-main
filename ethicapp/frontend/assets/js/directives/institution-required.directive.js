export let InstitutionRequired = () => {
    return {
      restrict: 'A',
      require: 'ngModel',
      scope: {
        accountType: '='
      },
      link: function(scope, element, attrs, ngModelCtrl) {
        function validateInstitution(value) {
          var isValid = !(scope.accountType === 'Teacher' && !value);
          ngModelCtrl.$setValidity('institutionRequired', isValid);
          return value;
        }
  
        ngModelCtrl.$parsers.push(validateInstitution);
  
        scope.$watch('accountType', function() {
          validateInstitution(ngModelCtrl.$modelValue);
        });
      }
    }
};