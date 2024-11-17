let activityControlsDirective = function() {
    return {
        restrict: 'E',
        scope: {
            isFinished: '<', // Boolean: Determines if the activity is finished
            parentCtrl: '<'  // Reference to the parent controller
        },
        template: `
            <div class="panel panel-default">
                <div class="panel-body">
                    <div class="row">
                        <div class="col-md-12 text-center">
                            <!-- Section 1: Main Actions -->                             
                            <button class="btn btn-default btn-sm" ng-click="parentCtrl.startNextPhase()">
                                <i class="fa-solid fa-forward text-success"></i> {{ 'start_next_phase_button' | translate }}
                            </button>
                            <button class="btn btn-default btn-sm" ng-click="parentCtrl.endActivity()">
                                <i class="fa-solid fa-stop-circle text-danger"></i> {{ 'end_activity_button' | translate }}
                            </button>
            
                            <!-- Separator -->
                            <span class="button-separator" ng-if="isFinished">|</span>
            
                            <!-- Section 2: Reports -->
                            <button class="btn btn-default btn-sm" ng-click="parentCtrl.downloadAnswersReport()" ng-if="isFinished">
                                <i class="fa-solid fa-file-alt text-primary"></i> {{ 'answers_report_button' | translate }}
                            </button>
                            <button class="btn btn-default btn-sm" ng-click="parentCtrl.downloadChatLog()" ng-if="isFinished">
                                <i class="fa-solid fa-comments text-info"></i> {{ 'chat_log_button' | translate }}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `
    };
};

export { activityControlsDirective };