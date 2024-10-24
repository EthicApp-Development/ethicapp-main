export let LoginController = ($scope, $http, $window) => {
    let self = $scope;

    self.loginError = false;

    self.clearErrors = function () {
        self.loginError = false;
        if (self.formLogin) {
            angular.forEach(self.formLogin.$error, (errorField) => {
                angular.forEach(errorField, (field) => {
                    field.$setUntouched();
                });
            });
        }
    };    

    self.login = () => {
        const credentials = {
            email:    self.user.email,
            password: self.user.password
        };

        $http.post("/login", credentials)
            .then(response => {
                const sessionID = response.data.sessionID;

                if (sessionID === "ErrorCredential") {
                    self.loginError = true;
                } else if (sessionID === "Unauthorized") {
                    self.loginError = true; // Mensaje de no autorizado
                } else {
                    // Si todo es exitoso, redirige al usuario
                    $window.location.href = "/seslist";
                }
            })
            .catch(error => {
                console.error(error);
                self.loginError = true;
            });
    };
};
