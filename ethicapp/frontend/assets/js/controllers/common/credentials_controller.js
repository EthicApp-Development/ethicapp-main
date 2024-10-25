import { getRecaptchaResponse } from "./recaptcha_api.js";

export let CredentialsController = ($scope, $http, $window) => {
    let self = $scope;
    self.user = {};

    self.emailSent = false;
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

    self.clearErrors = function () {
        self.backendError = false;
    };

    self.requestPasswordChange = function () {
        let recaptchaResponse = null;
        
        try {
            recaptchaResponse = getRecaptchaResponse();
        } catch(error) {
            console.error(error);
            self.backendError = true;
            self.backendErrorMessage = "captcha_error";
            return;
        }

        const params = {
            email:                self.user.email,
            g_recaptcha_response: recaptchaResponse
        };

        $http.post("/forgot", params)
            .then(response => {
                if (response.status === 200) {
                    console.log("password change success!");
                    self.emailSent = true;
                } else {
                    self.backendError = true;
                    self.backendErrorMessage = response.data.message;
                }
            })
            .catch(error => {
                console.error(error);
                self.backendError = true;
                self.backendErrorMessage = "An unexpected error occurred.";
            });
    };
};
