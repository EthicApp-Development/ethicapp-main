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
                console.debug("password reset request success!");
                self.emailSent = true;
            }
        })
        .catch(error => {
            if (error.status === 409) {
                console.debug("user does not exist!");
                self.emailSent = false;
                self.backendError = true;
                self.backendErrorMessage = "email_doesnt_exist";
            } else {
                self.backendError = true;
                self.backendErrorMessage = "complete_request_error";
            }
        });
    };

    self.resetPassword = function() {

    };
};
