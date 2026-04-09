module.exports = [
  '$scope',
  '$http',
  function RegistrationController($scope, $http) {
    $scope.formData = {
      name: '',
      lastname: '',
      dni: '',
      gender: '',
      password: '',
      password_confirmation: ''
    };

    $scope.errors = {};
    $scope.isSubmitting = false;
    $scope.serverError = null;
    $scope.registrationSuccess = false;

    $scope.submitRegistration = function submitRegistration() {
      $scope.errors = {};
      $scope.serverError = null;
      $scope.registrationSuccess = false;

      if (!$scope.formData.name || !$scope.formData.name.trim()) {
        $scope.errors.name = 'Name is required.';
      }

      if (!$scope.formData.lastname || !$scope.formData.lastname.trim()) {
        $scope.errors.lastname = 'Last name is required.';
      }

      if (!$scope.formData.dni || !$scope.formData.dni.trim()) {
        $scope.errors.dni = 'DNI is required.';
      }

      if (!$scope.formData.gender || !$scope.formData.gender.trim()) {
        $scope.errors.gender = 'Gender is required.';
      }

      if (!$scope.formData.password) {
        $scope.errors.password = 'Password is required.';
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

      $http.post('/register', {
        name: $scope.formData.name,
        lastname: $scope.formData.lastname,
        dni: $scope.formData.dni,
        gender: $scope.formData.gender,
        password: $scope.formData.password,
        password_confirmation: $scope.formData.password_confirmation
      })
        .then(function onSuccess() {
          $scope.registrationSuccess = true;
        })
        .catch(function onError(error) {
          $scope.serverError =
            (error.data && error.data.error) ||
            'Registration failed. Please try again.';
        })
        .finally(function onFinally() {
          $scope.isSubmitting = false;
        });
    };
  }
];