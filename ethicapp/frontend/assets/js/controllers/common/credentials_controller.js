import { getRecaptchaResponse } from "./recaptcha_api";

export let CredentialsController = ($scope, $http, $window) => {
    let self = $scope;

    self.emailSent = false;
    self.backendError = false;

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
            self.backendErorMessage = "captcha_error";
            return;
        }

        const params = {
            email:                self.user.email,
            g_recaptcha_response: recaptchaResponse
        };

        $http.post("/forgot", params)
            .then(response => {
                if (response.data.status === "success") {
                    self.emailSent = true;
                } else {
                    self.backendError = response.data.message;
                }
            })
            .catch(error => {
                console.error(error);
                self.backendError = "An unexpected error occurred.";
            });
    };

    self.resetPassword = function () {
        let recaptchaResponse = null;
        
        try {
            recaptchaResponse = getRecaptchaResponse();
        } catch(error) {
            console.error(error);
            self.backendError = true;
            self.backendErorMessage = "captcha_error";
            return;
        }

        if (self.user.newPassword !== self.user.confirmPassword) {
            return;
        }

        const resetData = {
            email:                self.user.username,
            pass:                 self.user.newPassword,
            cpass:                self.user.confirmPassword,
            g_recaptcha_response: recaptchaResponse
        };

        $http.post("/reset-password", resetData)
            .then(response => {
                if (response.data.status === "success") {
                    $window.location.href = "/login?rc=password_updated";
                } else {
                    self.backendError = response.data.message;
                }
            })
            .catch(error => {
                console.error(error);
                self.backendError = "An unexpected error occurred.";
            });
    };
};
