export let RegistrationsController = ($scope, $http) => {
    var self = $scope;
    self.user = {};

    self.backendErrors = false;
    self.teacherAccountRequested = false;

    self.validateRecaptcha = function () {
        try {
            let response = grecaptcha.getResponse();
            if (response.length === 0) {
                return false;
            } else {
                self.recaptchaError = "";
                return true;
            }    
        } catch (error) {
            return false;
        }
    };

    let commonBackendErrorHandler = (error) => {
        // Set the flag to display the error message
        self.backendErrors = true;

        // Detect and handle different types of errors
        if (error.status === 409) {
            // Email is already registered
            console.error("The email is already registered.");
            self.errorMessage = "account_already_exists"; // Duplicate email
        } else if (error.status === 400 && 
                error.data.message === "Error in captcha verification.") {
            console.error("Error in captcha verification.");
            self.errorMessage = "captcha_error"; // Captcha error
        } else if (error.status === 500) {
            console.error("An error occurred on the server.");
            self.errorMessage = "registration_error"; // Generic server error;
        } else {
            console.error("Unknown error. Please try again.");
            self.errorMessage = "registration_error"; // Unknown error
        }
    };

    self.registerUser = () => {    
        let recaptchaResponse = null;
        try {
            if (!self.validateRecaptcha()) {
                throw new Error("Could not validate recaptcha.");
            }
            recaptchaResponse = grecaptcha.getResponse();
        } catch (error) {
            console.error(error);
            self.recaptchaError = "captcha_error";
            return;
        }

        const userData = {
            name:                 self.user.firstname,
            lastname:             self.user.lastname,
            email:                self.user.email,
            pass:                 self.user.password,
            sex:                  self.user.gender,
            g_recaptcha_response: recaptchaResponse  
        };

        if (self.user.accountType === "Teacher") {
            userData.institution = self.user.institution;
            $http.post("/teacher_account_request", userData)
                .then(function (response) {
                    if (response.data.success) {
                        console.log("Successful teacher account request");
                        self.teacherAccountRequested = true;
                    } else {
                        throw new Error(
                            `Error handling teacher account request ${response.data.message}`);
                    }
                })
                .catch(commonBackendErrorHandler);
        } else if (self.user.accountType === "Student") {
            $http.post("/register", userData)
                .then(function (response) {
                    if (response.data.success) {
                        console.log("Successful registration");
                        window.location.href = "/login?rc=welc";
                    } else {
                        throw new Error(`Error in registration: ${response.data.message}`);
                    }
                })
                .catch(commonBackendErrorHandler);
        }
    };

    self.clearErrors = function() {
        self.errorMessage = "";
        self.backendErrors = false;
    };
};
