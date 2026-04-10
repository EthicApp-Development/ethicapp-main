module.exports = [
    "$scope",
    "$http",
    "$window",
    function LoginController($scope, $http, $window) {
        $scope.formData = {
            username: "",
            password: ""
        };

        $scope.isSubmitting = false;
        $scope.serverError = null;

        $scope.submitLogin = function submitLogin(form) {
            $scope.serverError = null;

            if (form.$invalid) {
                return;
            }

            $scope.isSubmitting = true;

            $http.post("/login", {
                username: $scope.formData.username,
                password: $scope.formData.password
            })
                .then(function onSuccess(response) {
                    if (response.data && response.data.redirectTo) {
                        $window.location.href = response.data.redirectTo;
                        return;
                    }

                    $window.location.href = "/";
                })
                .catch(function onError(error) {
                    $scope.serverError =
            (error.data && error.data.error) ||
            "Falló el acceso. Verifica tus credenciales.";
                })
                .finally(function onFinally() {
                    $scope.isSubmitting = false;
                });
        };
    }
];