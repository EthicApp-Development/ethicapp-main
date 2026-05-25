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
                const phaseId = await $scope.parentCtrl.startNextPhase();
                if (phaseId) {
                    $scope.$emit("activity:phase-advanced", { phaseId });
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
                                <button ng-if="!isLastPhase" type="button" class="btn btn-default btn-sm hold-button" hold-to-confirm hold-ms="2500" on-confirm="startNextPhaseAndNotify()">
                                    <i class="fa-solid fa-forward text-success"></i> {{ 'start_next_phase_button' | translate }}
                                    <span class="hold-progress" aria-hidden="true"></span>
                                </button>
                                <button type="button" class="btn btn-default btn-sm hold-button" hold-to-confirm hold-ms="2500" on-confirm="parentCtrl.endActivity()">
                                    <i class="fa-solid fa-stop-circle text-danger"></i> {{ 'end_activity_button' | translate }}
                                    <span class="hold-progress" aria-hidden="true"></span>
                                </button>
                            </div>
            
                            <!-- Section 2: Reports -->
                            <div ng-if="isFinished" class="report-buttons">
                                <button class="btn btn-default btn-sm" ng-click="parentCtrl.openActivityReports()">
                                    <i class="fa-solid fa-file-export text-primary"></i> {{ 'activity_reports_button' | translate }}
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
