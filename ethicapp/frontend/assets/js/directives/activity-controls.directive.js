let activityControlsDirective = function() {
    return {
        restrict: 'E',
        scope: {
            isFinished: '<', // Boolean: Determines if the activity is finished
            isLastPhase: '<',
            parentCtrl: '<'  // Reference to the parent controller
        },
        controller: ["$scope", async function($scope) {
            $scope.startNextPhaseAndNotify = async function() {
                const phaseStarted = await $scope.parentCtrl.startNextPhase();
                if (phaseStarted) {
                    $scope.$emit("activity:phase-advanced");
                }
            };
        }],
        template: `
            <div class="panel panel-default">
                <div class="panel-body">
                    <div class="row">
                        <div class="col-md-12 text-center">
                            <!-- Section 1: Main Actions -->
                            <div ng-if="!isFinished" class="action-buttons">
                                <button ng-if="!isLastPhase" class="btn btn-default btn-sm" ng-click="startNextPhaseAndNotify()">
                                    <i class="fa-solid fa-forward text-success"></i> {{ 'start_next_phase_button' | translate }}
                                </button>
                                <button class="btn btn-default btn-sm" ng-click="parentCtrl.endActivity()">
                                    <i class="fa-solid fa-stop-circle text-danger"></i> {{ 'end_activity_button' | translate }}
                                </button>
                            </div>
            
                            <!-- Section 2: Reports -->
                            <div ng-if="isFinished" class="report-buttons">
                                <button class="btn btn-default btn-sm" ng-click="parentCtrl.downloadAnswersReport()">
                                    <i class="fa-solid fa-file-alt text-primary"></i> {{ 'answers_report_button' | translate }}
                                </button>
                                <button class="btn btn-default btn-sm" ng-click="parentCtrl.downloadChatLog()">
                                    <i class="fa-solid fa-comments text-info"></i> {{ 'chat_log_button' | translate }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `
    };
};

export { activityControlsDirective };
