export let ProfileController = ($scope, $http) => {
    self.init = function () {
        $http.get("/users/:id").success((data) => {
            $scope.userProfile = data;
        }).error(() =>
        {
            console.error("[error] Could not load user profile data.");
        });
    };

    $scope.getUserProfile = function(){
        console.log("[debug] getUserProfile called!");
    };   

    $scope.init();
};