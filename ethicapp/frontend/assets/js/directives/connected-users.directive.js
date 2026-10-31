import { hiddenNameUsers } from "../helpers/hidden-names.js";

let connectedUsersDirective = function() {
    return {
        restrict: "E",
        scope:    {
            sessionId:        "@",
            // While the dashboard hides names (#897), students show their
            // pseudonym number instead of their name and email, ordered by
            // number. `pseudonymNumbers` maps student ids to numbers.
            hideNames:        "<?",
            pseudonymNumbers: "<?"
        },
        templateUrl:  "static/views/teacher/connected-users.html",
        controller:   "ConnectedUsersDirectiveController",
        controllerAs: "ctrl" // Use controller aliasing
    };
};

let ConnectedUsersDirectiveController = function($scope, ActivityStateService, $translate) {
    const ctrl = this; // Alias for the controller instance

    // State for sorting
    ctrl.orderByField = "name";
    ctrl.reverseSort = false;

    // Users list
    ctrl.users = [];

    // The list with hidden names, worked out again only when the users, the
    // numbers or the language change, so the table's watchers settle.
    let hiddenUsers = { users: null, numbers: null, language: null, list: [] };

    const translateInstant = function(key, params) {
        return typeof $translate?.instant === "function" ? $translate.instant(key, params) : key;
    };

    const currentLanguage = function() {
        return typeof $translate?.use === "function" ? $translate.use() : "";
    };

    ctrl.hidesNames = function() {
        return $scope.hideNames === true;
    };

    // The users as the table shows them: as they are, or named by number
    // while names are hidden.
    ctrl.displayUsers = function() {
        if (!ctrl.hidesNames()) {
            return ctrl.users;
        }
        const numbers = $scope.pseudonymNumbers;
        const language = currentLanguage();
        if (hiddenUsers.users !== ctrl.users || hiddenUsers.numbers !== numbers
            || hiddenUsers.language !== language) {
            hiddenUsers = {
                users: ctrl.users,
                numbers,
                language,
                list:  hiddenNameUsers(ctrl.users, { numbers, translate: translateInstant }),
            };
        }
        return hiddenUsers.list;
    };

    // The field the table is ordered by. While names are hidden, the name
    // column orders by number, never by name.
    ctrl.orderField = function() {
        const byNumber = ctrl.hidesNames() && ctrl.orderByField === "name";
        return byNumber ? "hiddenOrder" : ctrl.orderByField;
    };

    // Load the user list for the current session
    ctrl.loadUsers = async function(refresh = false) {
        try {
            const users = await ActivityStateService.getSessionUsers($scope.sessionId, refresh);
            ctrl.users = users;
            $scope.$applyAsync(); // Ensure Angular detects the changes
        } catch (error) {
            console.error("Error getting the user list:", error);
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
