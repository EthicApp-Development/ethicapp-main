function ErrorController($scope, $window, $routeParams) {
    const vm = this;
    vm.backSteps = 1;

    vm.init = function() {
        if ("backSteps" in $routeParams) {
            vm.backSteps =  $routeParams.backSteps;
            console.log(`init backSteps ${vm.backSteps}`);
        }
    };

    vm.goBack = function(steps = 1) {
        console.log(`goBack ${steps}`);
        $window.history.go(-1*steps);
      };
    
    vm.init();
};

export { ErrorController };