module.exports = [
  '$scope',
  '$http',
  '$window',
  function PasswordRecoveryController($scope, $http, $window) {
    $scope.formData = {
      token: '',
      password: '',
      password_confirmation: ''
    };

    $scope.errors = {};
    $scope.isSubmitting = false;
    $scope.serverError = null;
    $scope.passwordResetSuccess = false;

    function getTokenFromUrl() {
      const params = new URLSearchParams($window.location.search);
      return params.get('token') || '';
    }

    $scope.formData.token = getTokenFromUrl();

    $scope.submitNewPassword = function submitNewPassword() {
      $scope.errors = {};
      $scope.serverError = null;
      $scope.passwordResetSuccess = false;

      if (!$scope.formData.token) {
        $scope.errors.token = 'Recovery token is required.';
      }

      if (!$scope.formData.password) {
        $scope.errors.password = 'New password is required.';
      }

      if (!$scope.formData.password_confirmation) {
        $scope.errors.password_confirmation = 'Password confirmation is required.';
      }

      if (
        $scope.formData.password &&
        $scope.formData.password_confirmation &&
        $scope.formData.password !== $scope.formData.password_confirmation
      ) {
        $scope.errors.password_confirmation = 'Passwords do not match.';
      }

      if (Object.keys($scope.errors).length > 0) {
        return;
      }

      $scope.isSubmitting = true;

      $http.post('/newpassword', {
        token: $scope.formData.token,
        password: $scope.formData.password,
        password_confirmation: $scope.formData.password_confirmation
      })
        .then(function onSuccess() {
          $scope.passwordResetSuccess = true;
        })
        .catch(function onError(error) {
          $scope.serverError =
            (error.data && error.data.error) ||
            'Password reset failed. Please request a new recovery link.';
        })
        .finally(function onFinally() {
          $scope.isSubmitting = false;
        });
    };
  }
];