import * as PhaseCreationHelpers from "../../helpers/phase-creation-helpers.js";
import * as DesignHelpers from "../../helpers/design-helpers.js";
import { DashboardDataJoiners } from "../../helpers/dashboard-data-joiners.js";

/*eslint func-style: ["error", "expression"]*/
export function DashboardController($scope, $routeParams, $http, 
    $timeout, $uibModal, ActivityStateService, DesignCatalogService, $translate) {

    const vm = this;

    vm.designObj = null;
    vm.userList = [];
    vm.reachedLastPhase = false;
    vm.dashboardPhaseStates = [];

    vm.init = async function () {
        let id = $routeParams.id;

        if (!id || isNaN(Number(id))) {
            $scope.navigateTo("/error/404/2");
            return; 
        }

        // Session Id for this instance
        vm.sessionId = Number(id);

        // Display the info tab by default
        vm.activeTab = 'info';

        // Keep the activity state service subscribed to state updates from the backend.
        const unsubscribeHandler = ActivityStateService.subscribeToActivityEvents(vm.sessionId);

        ActivityStateService.registerListener("onStudentJoined",
            vm.studentJoinHandler);
        ActivityStateService.registerListener("onResponseSubmitted",
            vm.defaultEventHandler);
        ActivityStateService.registerListener("onChatMessage",
            vm.defaultEventHandler);

        $scope.$on("$destroy", () => {
            ActivityStateService.unregisterListener("onStudentJoined",
                vm.studentJoinHandler
            );
            ActivityStateService.unregisterListener("onResponseSubmitted",
                vm.defaultEventHandler
            );
            ActivityStateService.unregisterListener("onChatMessage",
                vm.defaultEventHandler
            );

            // Stop ActivityStateService listening to events from the current session
            unsubscribeHandler();
        });

        vm.initializeDashboardState();
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

            if (vm.activityDescriptor.currentPhase.id != phaseId) {
                throw new Error("Abnormal state found.");
            }
            
            // Have we reached the last phase?
            vm.reachedLastPhase = vm.lastPhaseReached();

            // Update data for the current phase
            vm.updateDashboardPhaseState(phaseId);
        } catch (error) {
            console.error("Error in startActivityDesign:", error);
        }
    };

    vm.initializeDashboardState = async function() {
        try {
            // Load the entire activity state
            vm.activityState = await ActivityStateService.loadActivityState(vm.sessionId);
            vm.userList = vm.activityState.users;
    
            // Get the activity descriptor
            vm.activityDescriptor = vm.activityState.descriptor;
            console.debug(`[DashboardController::init] ${JSON.stringify(vm.activityDescriptor)}`);
                
            vm.isActivityFinished = vm.isActivityFinished();
            vm.setActivityTitle();
    
            // Get the design of the activity
            vm.designObj = await DesignCatalogService.getDesignById(vm.activityDescriptor.designId);
    
            // Have we reached the last phase?
            vm.reachedLastPhase = vm.activityDescriptor.currentPhase.number == vm.designObj.phases.length;
    
            // Get phase instances
            const phaseInstances = await ActivityStateService.getInstancedPhases(vm.sessionId);
            
            // Initialize dashboard phase states using Promise.all for efficiency
            const phaseStatePromises = phaseInstances.map(async (phase) => {
                try {    
                    const phaseState = await vm.loadDashboardPhaseState(phase.id);
                    return phaseState;
                } catch (error) {
                    console.error(`Error loading state for phase ${phase.id}:`, error);
                    return null;
                }
            });
    
            // Wait for all phase states to be loaded
            const resolvedPhaseStates = await Promise.all(phaseStatePromises);
            vm.dashboardPhaseStates = resolvedPhaseStates.filter(state => state !== null);
        } catch (error) {
            console.error("Error during initializeDashboardState:", error);
        }
    };

    vm.updateDashboardPhaseState = async (phaseId) => {
        let phaseState = vm.dashboardPhaseStates.find(ps => ps.phaseDescriptor.phaseId == phaseId);
    
        if (!phaseState) {
            phaseState = await vm.loadDashboardPhaseState(phaseId);
            if (phaseState) vm.dashboardPhaseStates.push(phaseState);
        }
        else {
            await vm.loadDashboardPhaseState(phaseId, phaseState);
        }
    };
    
    vm.loadDashboardPhaseState = async (phaseId, phaseState = null) => {
        try {
            const designType = vm.designObj.metainfo.type;
            const builder = dashboardStateBuilders[designType];
    
            if (!builder) throw new Error(`No builder found for design type: ${designType}`);
    
            const phaseDescriptor = vm.activityDescriptor.phases.find(p => p.id == phaseId);
            if (!phaseDescriptor) throw new Error(`Phase descriptor not found for phaseId: ${phaseId}`);
    
            const phaseResponses = vm.activityState.responses.find(
                pr => pr.responses.phase_number == phaseDescriptor.number
            )?.responses;
    
            let [groups, chatMessageCount] = [null, null];
            if (DesignHelpers.isGroupPhaseByPhaseDescriptor(phaseDescriptor)) {
                [groups, chatMessageCount] = await Promise.all([
                    ActivityStateService.getGroups(phaseId),
                    ActivityStateService.getChatMessageCount(phaseId),
                ]);
            }

            const phaseStats = await ActivityStateService.getPhaseStats(phaseId);
    
            phaseState = builder(
                phaseDescriptor, 
                phaseResponses, 
                vm.userList, 
                groups, 
                chatMessageCount,
                phaseState
            );

            return { descriptor: phaseDescriptor, state: phaseState, stats: phaseStats };
        } catch (error) {
            console.error(`Failed to load dashboard state for phaseId: ${phaseId}`, error);
            return null;
        }
    };
    
    const genericBuilder = (phaseDescriptor, responses, users, groups, chatMessageCount, 
        builderSteps, phaseState = null) => {
        try {
            phaseState = builderSteps.joinPhaseData(
                phaseDescriptor, 
                responses, 
                users, 
                chatMessageCount, 
                phaseState);
    
            if (DesignHelpers.isGroupPhaseByPhaseDescriptor(phaseDescriptor)) {
                phaseState = builderSteps.addGroupInfo(phaseState, groups);
                phaseState = builderSteps.updateGroupStatistics(phaseState);
            }
    
            return phaseState;
        } catch (error) {
            console.error("Error building dashboard state", error);
            throw error;
        }
    };
    
    const dashboardStateBuilders = {
        semantic_differential: (phaseDescriptor, responses, users, groups, 
                                chatMessageCount, phaseState) =>
            genericBuilder(
                phaseDescriptor, 
                responses,
                users,
                groups,
                chatMessageCount,
                DashboardDataJoiners.semantic_differential,
                phaseState
            ),
        ranking: (phaseDescriptor, responses, users, groups, 
                  chatMessageCount, phaseState) =>
            DashboardDataJoiners.ranking.assignRankingClusters(
                genericBuilder(
                    phaseDescriptor, 
                    responses,
                    users,
                    groups,
                    chatMessageCount,
                    DashboardDataJoiners.ranking,
                    phaseState
                )
            ),
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

    vm.studentJoinHandler = function (data) {
        if (vm.isActivityFinished()) {
            return;
        }
        vm.userList = vm.activityState.users;
        vm.updateDashboardPhaseState(currentPhaseId);
    };

    vm.defaultEventHandler = function (data) {
        const currentPhaseId = vm?.activityDescriptor?.currentPhase?.id;
        if (!currentPhaseId) {
            console.warn("Unable to resolve the current phase");
            return;
        }
        vm.updateDashboardPhaseState(currentPhaseId);
    };

    vm.lastPhaseReached = function() {
        return vm.activityDescriptor.currentPhase.number == vm.designObj.phases.length;
    }

    vm.isActivityFinished = function() {
        return vm.activityDescriptor.status === "finished";        
    }

    vm.init();
};