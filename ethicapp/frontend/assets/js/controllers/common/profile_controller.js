export let ProfileController = ($scope, $http) => {
    $scope.init = function () {
        $http.get("/users/:id")
            .then((response) => {
                $scope.userProfile = response.data;
            })
            .catch(() => {
                console.error("[error] Could not load user profile data.");
            });
    };

    $scope.getUserProfile = function () {
        console.log("[debug] getUserProfile called!");
    };

    $scope.init();
};
