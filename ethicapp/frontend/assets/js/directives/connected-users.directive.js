let connectedUsersDirective = function() {
    return {
        restrict: 'E',
        scope: {
            sessionId: '@'
        },
        templateUrl: 'partials/teacher/connected-users.html',
        controller: 'ConnectedUsersDirectiveController'
    };
};

let ConnectedUsersDirectiveController = function($scope, ActivityStateService) {
    $scope.users = [];
    $scope.orderByField = 'name';
    $scope.reverseSort = false;

    // Load the user list for the current session
    function loadUsers() {
        ActivityStateService.getSessionUsers($scope.sessionId)
            .then(function(response) {
                $scope.users = response.data;
            })
            .catch(function(error) {
                console.error('Error al obtener usuarios:', error);
            });
    }

    loadUsers();

    // Sort listing by field
    $scope.sortBy = function(field) {
        if ($scope.orderByField === field) {
            $scope.reverseSort = !$scope.reverseSort;
        } else {
            $scope.orderByField = field;
            $scope.reverseSort = false;
        }
    };
}

export { connectedUsersDirective, ConnectedUsersDirectiveController };