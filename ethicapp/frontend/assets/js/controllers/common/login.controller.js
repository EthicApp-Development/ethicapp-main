export let LoginController = ($scope, $http, $window) => {
    let self = $scope;
    self.backendError = false;

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

    self.clearBackendErrors = function () {
        self.backendError = false;
        self.backendErrorMessage = "";
    };    

    self.login = () => {
        console.log("howdt");
        const credentials = {
            email:    self.user.email,
            password: self.user.password
        };

        $http.post("/login", credentials)
            .then(response => {
                if (response.status === 200) {
                    $window.location.href = "/seslist";
                }
            })
            .catch(error => {
                if (error.status === 401) {
                    self.backendError = true;
                    self.backendErrorMessage = "login_failed";
                } else {
                    self.backendError = true;
                    self.backendErrorMessage = "complete_request_error";
                }
            });
    };
};
