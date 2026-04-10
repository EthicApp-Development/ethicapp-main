module.exports = function passwordStrengthDirective() {
    return {
        require: "ngModel",
        link:    function(scope, element, attrs, ngModel) {

            ngModel.$validators.passwordStrength = function(value) {
                if (!value) return false;

                // Regla 1: longitud mínima
                if (value.length < 10) return false;

                // Regla 2: alfanuméricos + símbolos
                const symbolCount = (value.match(/[^a-zA-Z0-9]/g) || []).length;

                if (symbolCount < 2) return false;

                return true;
            };

        }
    };
};