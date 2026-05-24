export function ActivityReportsController($scope, $routeParams, $window) {
    const vm = this;

    vm.sessionId = Number($routeParams.session_id);
    vm.consentAccepted = false;

    vm.isValidSession = function() {
        return Number.isInteger(vm.sessionId) && vm.sessionId > 0;
    };

    vm.goBack = function() {
        if ($window.history.length > 1) {
            $window.history.back();
            return;
        }

        if (vm.isValidSession()) {
            $scope.navigateTo(`/activities/${vm.sessionId}`);
            return;
        }

        $scope.navigateTo("/activities");
    };

    vm.downloadFullReport = function() {
        if (!vm.consentAccepted || !vm.isValidSession()) {
            return;
        }
        $window.open(`/activity/${vm.sessionId}/full_report`, "_blank", "noopener");
    };

    vm.downloadChatTranscript = function() {
        if (!vm.consentAccepted || !vm.isValidSession()) {
            return;
        }
        $window.open(`/activity/${vm.sessionId}/chat_transcript`, "_blank", "noopener");
    };
}
