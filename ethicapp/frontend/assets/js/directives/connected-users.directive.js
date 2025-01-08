let connectedUsersDirective = function() {
    return {
        restrict: 'E',
        scope: {
            sessionId: '@'
        },
        templateUrl: 'static/views/teacher/connected-users.html',
        controller: 'ConnectedUsersDirectiveController',
        controllerAs: 'ctrl' // Use controller aliasing
    };
};

let ConnectedUsersDirectiveController = function($scope, ActivityStateService) {
    const ctrl = this; // Alias for the controller instance

    // State for sorting
    ctrl.orderByField = 'name';
    ctrl.reverseSort = false;

    // Users list
    ctrl.users = [];

    // Load the user list for the current session
    ctrl.loadUsers = async function(refresh = false) {
        try {
            const users = await ActivityStateService.getSessionUsers($scope.sessionId, refresh);
            ctrl.users = users;
            $scope.$applyAsync(); // Ensure Angular detects the changes
        } catch (error) {
            console.error('Error getting the user list:', error);
        }
    };

    // Sort the user list by a specified field
    ctrl.sortBy = function(field) {
        if (ctrl.orderByField === field) {
            ctrl.reverseSort = !ctrl.reverseSort;
        } else {
            ctrl.orderByField = field;
            ctrl.reverseSort = false;
        }
    };

    // Initialize the directive by loading users
    (async function init() {
        await ctrl.loadUsers(true); // Always refresh the list on initialization
    })();
};

export { connectedUsersDirective, ConnectedUsersDirectiveController };
