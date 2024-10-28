import { getRecaptchaResponse } from "./recaptcha_api.js";

export let RegistrationsController = ($scope, $http) => {
    var self = $scope;
    self.user = {};

    self.backendErrors = false;
    self.teacherAccountRequested = false;

    let commonBackendErrorHandler = (error) => {
        console.debug(JSON.stringify(error));

        // Set the flag to display the error message
        self.backendErrors = true;

        // Detect and handle different types of errors
        if (error.status === 409) {
            console.debug(
                "There is an issue with the email address provided.");
            self.backendErrorMessage = error.data.message; 
        } else if (error.status === 400 && 
                error.data.message === "Error in captcha verification.") {
            console.debug("Error in captcha verification.");
            self.backendErrorMessage = "captcha_error"; // Captcha error
        } else if (error.status === 500) {
            console.debug("An error occurred on the server.");
            self.backendErrorMessage = "registration_error"; // Generic server error;
        } else {
            console.debug("Unknown error. Please try again.");
            self.backendErrorMessage = "registration_error"; // Unknown error
        }
    };

    self.registerUser = () => {
        let recaptchaResponse = null;
        try {
            recaptchaResponse = getRecaptchaResponse();
            if (recaptchaResponse === null) {
                throw new Error("Got null recaptcha response");
            }
        } catch (error) {
            console.error(error);
            self.recaptchaError = "captcha_error";
            console.debug("captcha validation failed");           
            return;
        }

        const userData = {
            name:                 self.user.firstname,
            lastname:             self.user.lastname,
            email:                self.user.email,
            pass:                 self.user.password,
            sex:                  self.user.gender,
            locale:               self.currentLanguage,
            g_recaptcha_response: recaptchaResponse  
        };

        if (self.user.accountType === "Teacher") {
            userData.institution = self.user.institution;
            console.debug("attempting to request teacher account");

            $http.post("/teacher_account_request", userData)
                .then(function (response) {
                    console.debug(JSON.stringify(response));
                    if (response.data.success) {
                        console.debug("Successful teacher account request");
                        self.teacherAccountRequested = true;
                    } else {
                        console.debug("error requesting teacher account");
                        throw new Error(response.data.message);
                    }
                })
                .catch(commonBackendErrorHandler);
        } else if (self.user.accountType === "Student") {
            $http.post("/register", userData)
                .then(function (response) {
                    if (response.data.success) {
                        console.debug("Successful registration");
                        window.location.href = "/login?welc=email_validation_notice";
                    } else {
                        throw new Error(`Error in registration: ${response.data.message}`);
                    }
                })
                .catch(commonBackendErrorHandler);
        }
    };

    self.clearErrors = function() {
        self.backendErrorMessage = "";
        self.backendErrors = false;
    };
};
