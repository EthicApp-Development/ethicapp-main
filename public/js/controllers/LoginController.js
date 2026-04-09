module.exports = [
  '$scope',
  '$http',
  '$window',
  function LoginController($scope, $http, $window) {
    $scope.formData = {
      username: '',
      password: ''
    };

    $scope.errors = {};
    $scope.isSubmitting = false;
    $scope.serverError = null;

    $scope.submitLogin = function submitLogin() {
      $scope.errors = {};
      $scope.serverError = null;

      if (!$scope.formData.username || !$scope.formData.username.trim()) {
        $scope.errors.username = 'Username is required.';
      }

      if (!$scope.formData.password || !$scope.formData.password.trim()) {
        $scope.errors.password = 'Password is required.';
      }

      if (Object.keys($scope.errors).length > 0) {
        return;
      }

      $scope.isSubmitting = true;

      $http.post('/login', {
        username: $scope.formData.username,
        password: $scope.formData.password
      })
        .then(function onSuccess(response) {
          if (response.data && response.data.redirectTo) {
            $window.location.href = response.data.redirectTo;
            return;
          }

          $window.location.reload();
        })
        .catch(function onError(error) {
          $scope.serverError =
            (error.data && error.data.error) ||
            'Login failed. Please verify your credentials.';
        })
        .finally(function onFinally() {
          $scope.isSubmitting = false;
        });
    };
  }
];