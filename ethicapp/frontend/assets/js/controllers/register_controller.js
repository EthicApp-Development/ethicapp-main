export let RegisterController = ($scope, $http, $translate, apiParams) => {
    var self = $scope;
    self.reCaptchaSiteKey = apiParams.reCaptchaSiteKey;
    self.user = {};
    self.emailAlreadyExists = false; // Flag to track if email is already used

    self.validateRecaptcha = function () {
        var response = grecaptcha.getResponse();
        if (response.length === 0) {
            return false;
        } else {
            self.recaptchaError = "";
            return true;
        }
    };

    self.registerUser = () => {        
        if (!self.validateRecaptcha()) {
            self.recaptchaError = "Captcha validation is required.";
            return;
        }

        const userData = {
            name: self.user.firstname,
            lastname: self.user.lastname,
            email: self.user.email,
            pass: self.user.password,
            sex: self.user.gender,
            g_recaptcha_response: grecaptcha.getResponse()
        };

        if (self.user.accountType === 'Teacher') {
            userData.institution = self.user.institution;
            $http.post("/teacher_account_request", userData)
                .then(function (response) {
                    if (response.data.success) {
                        console.log("Successful teacher account request");
                        window.location.href = "/login?rc=6";
                        
                    } else {
                        console.error("Error in teacher account request: ", response.data.message);
                    }
                })
                .catch(function (error) {
                    // Detect and handle different types of errors
                    if (error.status === 409) {
                        // Email is already registered
                        console.error("The email is already registered. Please use another one or log in.");
                        self.emailAlreadyExists = true; // Set the flag to display the error message
                    } else if (error.status === 400 && error.data.message === "Error in captcha verification.") {
                        console.error("Error in captcha verification. Please try again.");
                        self.errorMessage = "Error in captcha verification. Please try again.";
                    } else if (error.status === 500) {
                        console.error("An error occurred on the server. Please try again later.");
                        self.errorMessage = "An error occurred on the server. Please try again later.";
                    } else {
                        console.error("Unknown error. Please try again.");
                        self.errorMessage = "Unknown error. Please try again.";
                    }
                });

        } else if (self.user.accountType === 'Student') {
            $http.post("/register", userData)
                .then(function (response) {
                    if (response.data.success) {
                        console.log("Successful registration");
                        window.location.href = "/login?rc=1";
                    } else {
                        console.error("Error in registration: ", response.data.message);
                    }
                })
                .catch(function (error) {
                    // Detect and handle different types of errors
                    if (error.status === 409) {
                        // Email is already registered
                        console.error("The email is already registered. Please use another one or log in.");
                        self.emailAlreadyExists = true; // Set the flag to display the error message
                    } else if (error.status === 400 && error.data.message === "Error in captcha verification.") {
                        console.error("Error in captcha verification. Please try again.");
                        self.errorMessage = "Error in captcha verification. Please try again.";
                    } else if (error.status === 500) {
                        console.error("An error occurred on the server. Please try again later.");
                        self.errorMessage = "An error occurred on the server. Please try again later.";
                    } else {
                        console.error("Unknown error. Please try again.");
                        self.errorMessage = "Unknown error. Please try again.";
                    }
                });
        }
    };

    self.init = function () {
        const browserLanguage = navigator.language;
        const appLanguage = browserLanguage.startsWith('es') ? 'ES_CL/spanish' : 'EN_US/english';
        console.log(appLanguage);
        $translate.use(appLanguage);
    };

    self.init();
};
