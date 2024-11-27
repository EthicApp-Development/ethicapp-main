import * as PhaseCreationHelpers from "../../helpers/phase-creation-helpers.js";
import * as DesignHelpers from "../../helpers/design-helpers.js";
import * as DashboardDataJoiners from "../../helpers/dashboard-data-joiners.js";

/*eslint func-style: ["error", "expression"]*/
export function DashboardController($scope, $routeParams, $http, 
    $timeout, $uibModal, ActivityStateService, ActivityCatalogService, 
    DesignCatalogService, $translate) {

    const vm = this;
    vm.designObj = null;
    vm.userList = [];
    vm.reachedLastPhase = false;
    vm.loadingChatStats = false;
    vm.loadingResponseStats = false;
    vm.chatStats = {};
    vm.responseStats = {};
    vm.phaseInstances = null;
    vm.dashboardState = {};

    vm.init = async function () {
        let id = $routeParams.id;
        console.log(`[DashboardController::init] ${id}`);

        if (!id || isNaN(Number(id))) {
            $scope.navigateTo("/error/404/2");
            return; 
        }

        // Session Id for this instance
        vm.sessionId = Number(id);

        // Display the info tab by default
        vm.activeTab = 'info';

        // Load the entire activity state
        vm.activityState = await ActivityStateService.loadActivityState(vm.sessionId);
        vm.userList = vm.activityState.users;

        // Phase instances
        vm.phaseInstances = await ActivityStateService.getInstancedPhases(vm.sessionId);

        // Get the activity descriptor
        vm.activityDescriptor = vm.activityState.descriptor;
        console.debug(`[DashboardController::init] ${JSON.stringify(vm.activityDescriptor)}`);

        vm.isActivityFinished = vm.activityDescriptor.status === "finished";
        vm.setActivityTitle();

         // Get the design of the activity
        vm.designObj = await DesignCatalogService.getDesignById(vm.activityDescriptor.designId);

        // Have we reached the last phase?
        vm.reachedLastPhase = vm.activityDescriptor.currentPhase.number == vm.designObj.phases.length;

        // Keep the activity state service subscribed to state updates from the backend.
        const unsubscribeHandler = ActivityStateService.subscribeToActivityEvents(vm.sessionId);

        ActivityStateService.registerListener("onStudentJoined",
            vm.studentJoinHandler);
        ActivityStateService.registerListener("onResponseSubmitted",
            vm.responseHandler);
        ActivityStateService.registerListener("onChatMessage",
            vm.chatMessageHandler);

        $scope.$on("$destroy", () => {
            ActivityStateService.unregisterListener("onStudentJoined",
                vm.studentJoinHandler
            );
            ActivityStateService.unregisterListener("onResponseSubmitted",
                vm.responseHandler
            );
            ActivityStateService.unregisterListener("onChatMessage",
                vm.chatMessageHandler
            );

            // Stop ActivityStateService listening to events from the current session
            unsubscribeHandler();
        });
    };

    vm.setActivityTitle = function() {
        $translate('activity_details_dashboard_title').then((translation) => {
            vm.activityTitle = translation;
        }).catch((error) => {
            console.error('Translation error:', error);
        });
    };

    vm.startNextPhase = async function() {
        try {
            const currentPhase = vm.activityDescriptor.currentPhase.number;

            if (currentPhase == vm.designObj.phases.length) {
                console.error("Cannot advance any further, reached the last phase already");
                return;
            }

            const nextPhaseIndex = currentPhase.number;
            const nextPhaseNumber = currentPhase.number + 1;
            const phase = design.phases[nextPhaseIndex];
            const requestObj = PhaseCreationHelpers.phaseCreationRequestObject(
                phase, nextPhaseNumber, vm.sessionId);

            const stageResponse = await $http({
                url: `/activities/${vm.sessionId}/phases`,
                method: "post",
                data: requestObj,
            });
            
            const phaseId = stageResponse.data.id;
            
            if (phaseId) {
                // Build the phase items
                const builder = PhaseCreationHelpers.itemBuilders[design.type];

                if (builder) {
                    await builder(phase, phaseId, vm.sessionId);
                } else {
                    console.warn(`No handler found for design type: ${design.type}`);
                }
            } else {
                console.error("Error creating activity phase");
            }

            await $http({ 
                url: `/activities/${vm.sessionId}/phase_transition`, 
                method: "post", 
                data: { phase_id: phaseId }
            });

            // Update the activity descriptor
            vm.activityDescriptor = await ActivityStateService.getActivityDescriptor(vm.sessionId, true);
            vm.isActivityFinished = vm.activityDescriptor.status === "finished";
            
            // Get udpated phase instances
            vm.phaseInstances = await ActivityStateService.getInstancedPhases(vm.sessionId);

            // Have we reached the last phase?
            vm.reachedLastPhase = vm.activityDescriptor.currentPhase.number == vm.designObj.phases.length;
        } catch (error) {
            console.error("Error in startActivityDesign:", error);
        }        
    };

    const dashboardStateBuilders = {
        semantic_differential: sdDashboardStateBuilder,
        ranking: rankingDashboardStateBuilder,
    };


    vm.updateDashboardState() = function() {
        vm.phaseInstances.forEach(phase => {
            const designType = designobj.metainfo.type;
            const builder = dashboardStateBuilders[designType];

            if (!builder) {
                console.error(`Could not find builder function for design type ${designType}`);
                return;
            }

        });
    };

    const sdDashboardStateBuilder = function () {

    }

    const rankingDashboardStateBuilder = function () {
        
    }

    vm.endActivity = function() {    
        $http.post('/activities/' + vm.sessionId + '/finish')
            .then(response => {
                console.log('Activity finished successfully:', response.data);
                vm.isActivityFinished = true;
            })
            .catch(error => {
                console.error('Error ending activity:', error);
            });
        
        vm.isActivityFinished = true;
    };

    vm.downloadAnswersReport = function() {
        console.log('Downloading answers report...');
    };

    vm.downloadChatLog = function() {
        console.log('Downloading chat log...');
    };

    vm.studentJoinHandler = function () {
        vm.userList = vm.activityState.users;
    };

    vm.responseHandler = function () {
        vm.responses = vm.activityState.responses;
    };

    vm.chatMessageHandler = function () {
        if (!vm.loadingChatStats) {
            vm.loadingChatStats = true;
            $timeout(function() {
                vm.loadingChatStats = false;
                const phaseId = vm.activityDescriptor.currentPhase.id;
                vm.chatStats = ActivityStateService.getChatMessageCount(phaseId);
            }, 5000);
        }
    };

    vm.init();
};