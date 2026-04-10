module.exports = [
    "$scope",
    "$http",
    "$window",
    function PasswordRecoveryController($scope, $http, $window) {
        $scope.formData = {
            token:                 "",
            password:              "",
            password_confirmation: ""
        };

        $scope.isSubmitting = false;
        $scope.serverError = null;
        $scope.passwordResetSuccess = false;
        $scope.showPassword = false;
        $scope.showPasswordConfirmation = false;

        function getTokenFromUrl() {
            var params = new URLSearchParams($window.location.search);
            return params.get("token") || "";
        }

        $scope.formData.token = getTokenFromUrl();

        $scope.submitNewPassword = function submitNewPassword(form) {
            $scope.serverError = null;

            if (!$scope.formData.token) {
                $scope.serverError = "El enlace de recuperación no es válido.";
                return;
            }

            if (form.$invalid) {
                return;
            }

            if ($scope.formData.password !== $scope.formData.password_confirmation) {
                return;
            }

            $scope.isSubmitting = true;

            $http.post("/newpassword", {
                token:                 $scope.formData.token,
                password:              $scope.formData.password,
                password_confirmation: $scope.formData.password_confirmation
            })
                .then(function onSuccess() {
                    $scope.passwordResetSuccess = true;
                })
                .catch(function onError(error) {
                    $scope.serverError =
            (error.data && error.data.error) ||
            "No se pudo actualizar la contraseña. Solicita un nuevo enlace de recuperación.";
                })
                .finally(function onFinally() {
                    $scope.isSubmitting = false;
                });
        };
    }
];