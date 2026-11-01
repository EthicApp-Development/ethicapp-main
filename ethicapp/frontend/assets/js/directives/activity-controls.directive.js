// The controls of a running activity, in the dashboard's activity bar (#893):
// start the next phase and end the activity, both held for 2.5 s
// (`hold-to-confirm`), or the reports once the activity is finished. A tooltip
// on hover and keyboard focus explains the hold; it is also each button's
// accessible description. Escape hides it while it is hovered or focused,
// until both the pointer and the focus leave the button (`dismissible-tip`,
// #956).
let activityControlsDirective = function() {
    return {
        restrict: "E",
        scope:    {
            isFinished:  "<", // Boolean: Determines if the activity is finished
            isLastPhase: "<",
            parentCtrl:  "<"  // Reference to the parent controller
        },
        controller: ["$scope", function($scope) {
            $scope.tipIds = {
                next: `activity-hold-tip-next-${$scope.$id}`,
                end:  `activity-hold-tip-end-${$scope.$id}`,
            };

            $scope.startNextPhaseAndNotify = async function() {
                const phaseId = await $scope.parentCtrl.startNextPhase();
                if (phaseId) {
                    $scope.$emit("activity:phase-advanced", { phaseId });
                }
            };
        }],
        template: `
            <div class="activity-controls">
                <div ng-if="!isFinished" class="action-buttons">
                    <span ng-if="!isLastPhase" class="activity-hold"
                          dismissible-tip="activity-hold-tip-dismissed">
                        <button type="button" class="btn btn-default btn-sm hold-button"
                                hold-to-confirm hold-ms="2500"
                                on-confirm="startNextPhaseAndNotify()"
                                aria-describedby="{{ tipIds.next }}">
                            <i class="fa-solid fa-forward text-success" aria-hidden="true"></i>
                            {{ 'start_next_phase_button' | translate }}
                            <span class="hold-progress" aria-hidden="true"></span>
                        </button>
                        <span class="activity-hold-tip" role="tooltip" id="{{ tipIds.next }}">
                            <span class="activity-hold-tip-body">
                                {{ 'activity_hold_next_phase_tip' | translate }}
                            </span>
                        </span>
                    </span>
                    <span class="activity-hold"
                          dismissible-tip="activity-hold-tip-dismissed">
                        <button type="button" class="btn btn-default btn-sm hold-button"
                                hold-to-confirm hold-ms="2500"
                                on-confirm="parentCtrl.endActivity()"
                                aria-describedby="{{ tipIds.end }}">
                            <i class="fa-solid fa-stop-circle text-danger" aria-hidden="true"></i>
                            {{ 'end_activity_button' | translate }}
                            <span class="hold-progress" aria-hidden="true"></span>
                        </button>
                        <span class="activity-hold-tip" role="tooltip" id="{{ tipIds.end }}">
                            <span class="activity-hold-tip-body">
                                {{ 'activity_hold_end_activity_tip' | translate }}
                            </span>
                        </span>
                    </span>
                </div>

                <div ng-if="isFinished" class="report-buttons">
                    <button type="button" class="btn btn-default btn-sm"
                            ng-click="parentCtrl.openActivityReports()">
                        <i class="fa-solid fa-file-export text-primary" aria-hidden="true"></i>
                        {{ 'activity_reports_button' | translate }}
                    </button>
                </div>
            </div>
        `
    };
};

export { activityControlsDirective };
