export let InstitutionRequired = () => {
    return {
      restrict: 'A',  // Usada como atributo
      require: 'ngModel',  // Requiere ngModel para controlar la validación
      scope: {
        accountType: '='  // Vinculamos el tipo de cuenta desde el formulario
      },
      link: function(scope, element, attrs, ngModelCtrl) {
        // Función para actualizar la validación
        function validateInstitution(value) {
          // Si la cuenta es 'Teacher' y el campo está vacío, es inválido
          var isValid = !(scope.accountType === 'Teacher' && !value);
          ngModelCtrl.$setValidity('institutionRequired', isValid);
          return value;
        }
  
        // Observa los cambios en el modelo (valor del campo institution)
        ngModelCtrl.$parsers.push(validateInstitution);
  
        // Observa los cambios en el tipo de cuenta
        scope.$watch('accountType', function() {
          validateInstitution(ngModelCtrl.$modelValue);
        });
      }
    }
};