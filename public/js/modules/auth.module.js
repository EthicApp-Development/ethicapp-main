const angular = window.angular;

const LoginController = require("../controllers/LoginController");
const RegistrationController = require("../controllers/RegistrationController");
const PasswordRecoveryController = require("../controllers/PasswordRecoveryController");
const passwordStrength = require("../directives/passwordStrength");

module.exports = angular
    .module("AuthModule", [])
    .controller("LoginController", LoginController)
    .controller("RegistrationController", RegistrationController)
    .controller("PasswordRecoveryController", PasswordRecoveryController)
    .directive("passwordStrength", passwordStrength)
    .name;