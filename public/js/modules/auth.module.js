const angular = require('angular');

const LoginController = require('../controllers/LoginController');
const RegistrationController = require('../controllers/RegistrationController');
const PasswordRecoveryController = require('../controllers/PasswordRecoveryController');

module.exports = angular
  .module('AuthModule', [])
  .controller('LoginController', LoginController)
  .controller('RegistrationController', RegistrationController)
  .controller('PasswordRecoveryController', PasswordRecoveryController)
  .name;