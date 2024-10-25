export let CredentialsController = ($scope, $http, $window) => {
    let self = $scope;

    self.emailSent = false;
    self.backendError = false;

    self.clearErrors = function () {
        self.backendError = false;
    };

    self.requestPasswordChange = function () {
        const emailData = {
            email: self.user.email
        };

        $http.post("/forgot", emailData)
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
        if (self.user.newPassword !== self.user.confirmPassword) {
            return;
        }

        const resetData = {
            username: self.user.username,
            newPassword: self.user.newPassword,
            confirmPassword: self.user.confirmPassword
        };

        $http.post("/reset-password", resetData)
            .then(response => {
                if (response.data.status === "success") {
                    // Redirigir al usuario tras el éxito
                    $window.location.href = "/login?flash=welc";
                } else {
                    // Mostrar mensaje de error del backend
                    self.backendError = response.data.message;
                }
            })
            .catch(error => {
                console.error(error);
                self.backendError = "An unexpected error occurred.";
            });
    };
};
