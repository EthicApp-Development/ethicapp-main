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

        // Get the activity descriptor
        vm.activityDescriptor = vm.activityState.descriptor;
        vm.isActivityFinished = vm.activityDescriptor.status === "finished";
        vm.setActivityTitle();

        console.debug(`[DashboardController::init] ${JSON.stringify(vm.activityDescriptor)}`);
 
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

    vm.loadPhaseStates = async function () {
        try {
            vm.phaseStates = [];
            
            // Get all instanced phases
            const instancedPhases = await ActivityStateService.getInstancedPhases(vm.sessionId, true);
    
            // Get all activity responses:
            const responses = await ActivityStateService.getResponses(vm.sessionId);

            // Iterate by means of an async loop
            for (const phase of instancedPhases) {
                const state = {};
    
                // Get response statistics
                state.responseStats = await ActivityStateService.getPhaseStats(phase.id);
    
                const phaseNumber = phase.number;
                const groupPhase = DesignHelpers.isGroupPhase(vm.designObj, phaseNumber);
    
                let messageCount = [];
                let groupChatStats = {};

                // If this is a group phase, get chat message statistics
                if (groupPhase) {
                    messageCount = await ActivityStateService.getChatMessageCount(phase.id);
                    groupChatStats = groupPhaseChatMessageSum(messageCount);
                }

                state.groupChatStats = groupChatStats;

                // Get users
                const users = await ActivityStateService.getSessionUsers(vm.sessionId, true);

                const designType = this.designObj.type;
                const joiner = DashboardDataJoiners.phaseDataJoiners(designType)

                if (!joiner) {
                    console.error(`Could not find a data joiner for design type '${designType}'`);
                }
                
                const phaseDescriptors = ActivityStateService.getActivityDescriptor(vm.sessionId);
                
                // Build one large table with a record per student in the phase
                const userStates = joiner(phase, users, responses, messageCount);
                state.userStates = userStates;

                vm.phaseStates.push(state);
            }
        } catch (error) {
            console.error("Error cargando estadísticas de las fases:", error);
        }
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
                phase, nextPhaseNumber, sessionId);

            const stageResponse = await $http({
                url: `/activities/${sessionId}/phases`,
                method: "post",
                data: requestObj,
            });
            
            const stageid = stageResponse.data.id;
            
            if (stageid) {
                // Build the phase items
                const builder = PhaseCreationHelpers.itemBuilders[design.type];

                if (builder) {
                    await builder(phase, stageid, sessionId);
                } else {
                    console.warn(`No handler found for design type: ${design.type}`);
                }
            } else {
                console.error("Error creating activity phase");
            }

            await $http({ 
                url: `/activities/${sessionId}/phase_transition`, 
                method: "post", 
                data: { phase_id: stageid }
            });

            // TODO: perform state update

            // Have we reached the last phase?
            vm.reachedLastPhase = vm.activityDescriptor.currentPhase.number == vm.designObj.phases.length;
                
        } catch (error) {
            console.error("Error in startActivityDesign:", error);
        }        
    };

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
        
    };

    vm.chatMessageHandler = function () {

    };

    vm.init();
};