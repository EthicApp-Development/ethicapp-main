export let LoginController = ($scope, $http, $window) => {
    let self = $scope;

    self.loginError = false;

    setTimeout(() => {
        const welcomeMessageElement = document.getElementById("welcome-message");
        if (welcomeMessageElement) {
            $scope.$apply(() => {
                $scope.welcomeMessage = welcomeMessageElement.getAttribute("data-welc");
            });
            console.debug("AngularJS: welcomeMessage set to:", $scope.welcomeMessage);
        } else {
            console.debug("AngularJS: welcomeMessage element not found");
        }
    }, 0);

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
                    self.loginError = true;
                } else {
                    $window.location.href = "/seslist";
                }
            })
            .catch(error => {
                console.error(error);
                self.loginError = true;
            });
    };
};
