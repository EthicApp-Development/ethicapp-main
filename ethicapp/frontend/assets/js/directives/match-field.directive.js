// match-field.directive.js
export let MatchFieldDirective = () => {
    return {
      require: 'ngModel',
      scope: {
        matchField: '='
      },
      link: function(scope, elem, attrs, ctrl) {
        ctrl.$validators.matchField = function(modelValue) {
          return modelValue === scope.matchField;
        };
  
        scope.$watch('matchField', function() {
          ctrl.$validate();
        });
      }
    };
};
