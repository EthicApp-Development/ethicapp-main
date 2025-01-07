export function ActivityController($scope, $routeParams, $http, $timeout, 
    StudentSocketService, StudentActivityStateService, translate) {
    
    const vm = this;
    vm.activityState = {};

    this.init = function() {
        let id = $routeParams.id;

        if (!id || isNaN(Number(id))) {
            $scope.navigateTo("/error/404/2");
            return; 
        }

        // Session Id for this instance
        vm.sessionId = Number(id);

        // Display the case tab by default
        vm.activeTab = 'case';

        // Keep the activity state service subscribed to state updates from the backend.
        const unsubscribeHandler = StudentActivityStateService.joinSession(vm.sessionId);

        StudentActivityStateService.registerListener("onPhaseTransition",
            vm.handlePhaseTransition);
        StudentActivityStateService.registerListener("onGroupMessage",
            vm.handleChatUpdate);
        StudentActivityStateService.registerListener("onShareResponse",
            vm.handleSharedResponse);
        StudentActivityStateService.registerListener("onEndSession",
            vm.handleEndSession);
    
        $scope.$on("$destroy", () => {
            StudentActivityStateService.unregisterListener("onPhaseTransition",
                vm.handlePhaseTransition
            );
            StudentActivityStateService.unregisterListener("onGroupMessage",
                vm.handleChatUpdate
            );
            StudentActivityStateService.unregisterListener("onShareResponse",
                vm.handleSharedResponse
            );
            StudentActivityStateService.unregisterListener("onEndSession",
                vm.handleEndSession
            );

            // Stop ActivityStateService listening to events from the current session
            unsubscribeHandler();

            StudentActivityStateService.leaveSession(vm.sessionId);
        });
    };

    vm.defaultEventHandler = function(data) {
        console.log(`[ActivityController::defaultEventHandler] ${JSON.stringify(data.params)}`);
    };

    vm.handlePhaseTransition = function(data) {

    };

    vm.handleSharedResponse = function(data) {

    };

    vm.handleChatUpdate = function(data) {

    };

    vm.handleEndSession = function(data) {

    };

    vm.init();
};