import * as PhaseCreationHelpers from "../../helpers/phase-creation-helpers.js";
import * as DesignHelpers from "../../helpers/design-helpers.js";
import { DashboardDataJoiners } from "../../helpers/dashboard-data-joiners.js";

/*eslint func-style: ["error", "expression"]*/
export function DashboardController($scope, $routeParams, $http, 
    $translate, $timeout, $uibModal, 
    ActivityStateService, ActivityCatalogService, DesignCatalogService) {

    const vm = this;

    vm.designObj = null;
    vm.userList = [];
    vm.reachedLastPhase = false;
    vm.dashboardPhaseData = [];
    
    vm.selectedTab = 0; // Default to the first tab

    vm.selectTab = function(index) {
        vm.selectedTab = index; // Update the selected tab index
    };

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

    vm.startNextPhase = async function () {
        try {
            // TODO: refactor, as the following operations should be performed by the service

            // Check if there are existing phases
            let currentPhaseNumber = vm.activityState.descriptor.currentPhase
                ? vm.activityState.descriptor.currentPhase.number
                : null;
    
            // Determine if we need to create the first phase
            if (currentPhaseNumber === null) {
                console.info("No phases found. Creating the first phase with number 1.");
                currentPhaseNumber = 0; // Start with 0 so we can increment to 1 below
            }
    
            // Check if we've already reached the last phase
            if (currentPhaseNumber === vm.designObj.phases.length) {
                console.error("Cannot advance any further, reached the last phase already.");
                return;
            }
    
            const nextPhaseIndex = currentPhaseNumber;
            const nextPhaseNumber = currentPhaseNumber + 1;

            // Get the current design object of the current phase
            const phase = vm.designObj.phases[nextPhaseIndex];
            const designType = DesignHelpers.getDesignType(vm.designObj);

            // Add the phase to the activity
            const phaseId = await ActivityStateService.addPhaseToActivity(
                phase,
                nextPhaseNumber,
                vm.sessionId
            );
    
            // Add items to the newly created phase
            if (phaseId) {
                await ActivityStateService.addItemsToPhase(
                    phase,
                    phaseId,
                    vm.sessionId,
                    designType
                );
            } else {
                console.error("Error creating activity phase.");
                return;
            }
    
            // Transition to the newly created phase
            await ActivityStateService.transitionToPhase(vm.sessionId, phaseId, phase);
    
            vm.isActivityFinished = vm.checkActivityFinished();
    
            if (vm.activityState.descriptor.currentPhase.id !== phaseId) {
                throw new Error("Abnormal state found.");
            }
    
            // Have we reached the last phase?
            $scope.$applyAsync(() => {
                vm.reachedLastPhase = vm.lastPhaseReached();
            });
    
            // Update data for the current phase
            vm.updateDashboardPhaseData(phaseId);
        } catch (error) {
            console.error("Error in startNextPhase:", error);
        }
    };

    vm.initializeDashboardState = async function() {
        try {
            // Load the entire activity state
            vm.activityState = await ActivityStateService.loadActivityState(vm.sessionId);
            vm.userList = vm.activityState?.users ?? [];
                    
            // Get the design of the activity
            vm.designObj = await DesignCatalogService.getDesignById(vm.activityState.descriptor.designId);
    
            // Check if the activity is finished
            vm.isActivityFinished = vm.checkActivityFinished();
            vm.setActivityTitle();

            // Have we reached the last phase?
            vm.reachedLastPhase = vm.lastPhaseReached();
    
            // Get phase instances
            const phaseInstances = await ActivityStateService.getInstancedPhases(vm.sessionId);
            
            // Initialize dashboard phase states using Promise.all for efficiency
            const phaseStatePromises = phaseInstances.map(async (phase) => {
                try {    
                    const phaseState = await vm.loadDashboardPhaseData(phase.id);
                    return phaseState;
                } catch (error) {
                    console.error(`Error loading state for phase ${phase.id}:`, error);
                    return null;
                }
            });
    
            // Wait for all phase states to be loaded
            const resolvedPhaseStates = await Promise.all(phaseStatePromises);

            $scope.$applyAsync(() => {
                vm.dashboardPhaseData = resolvedPhaseStates.filter(state => state !== null);
            });

        } catch (error) {
            console.error("Error during initializeDashboardState:", error);
        }
    };

    vm.updateDashboardPhaseData = async (phaseId) => {    
        try {
            let phaseData = vm.dashboardPhaseData.find(pd => pd.descriptor.id == phaseId);

            if (!phaseData) {
                phaseData = await vm.loadDashboardPhaseData(phaseId);
                if (phaseData) {
                    $scope.$applyAsync(() => {  
                        vm.dashboardPhaseData.push(phaseData);
                    });
                }
            }
            else {
                // Load the phase data partially, i.e., update the state, not fully recreate it.
                const updatedData = await vm.loadDashboardPhaseData(phaseId, phaseData.state);
                if (updatedData) {
                    $scope.$applyAsync(() => {
                        const index = vm.dashboardPhaseData.findIndex(pd => pd.descriptor.id == phaseId);
                        vm.dashboardPhaseData[index] = updatedData;
                    });
                }
            }
        } catch(error) {
            console.error("Error updating dashboard phase state:", error);
        }
    };
    
    vm.loadDashboardPhaseData = async (phaseId, phaseState = null) => {
        try {
            if (phaseId === null || phaseId === undefined) {
                console.warn("[DashboardController::loadDashboardPhaseData] PhaseId is null or undefined. Skipping phase state load.");
                return;
            }

            const designType = vm.designObj.type;
            const builder = dashboardStateBuilders[designType];
    
            if (!builder) throw new Error(`No builder found for design type: ${designType}`);
    
            const phaseDescriptor = vm.activityState.descriptor.phases.find(p => p.id == phaseId);
            if (!phaseDescriptor) throw new Error(`Phase descriptor not found for phaseId: ${phaseId}`);
    
            const phaseResponses = vm.activityState.responses.find(
                pr => pr.phase_number == phaseDescriptor.number
            )?.responses ?? [];
    
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
                phaseState = builderSteps.updateGroupStatistics(phaseState, $translate.instant);
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
        if (vm.checkActivityFinished()) {
            return;
        }

        const currentPhaseId = vm?.activityState?.descriptor?.currentPhase?.id;

        $scope.$applyAsync(() => { 
            vm.userList = vm.activityState.users;
        });

        vm.updateDashboardPhaseData(currentPhaseId);
    };

    vm.defaultEventHandler = function (data) {
        const currentPhaseId = vm?.activityState?.descriptor?.currentPhase?.id;
        if (!currentPhaseId) {
            console.warn("Unable to resolve the current phase");
            return;
        }
        vm.updateDashboardPhaseData(currentPhaseId);
    };

    vm.lastPhaseReached = function() {
        return vm.activityState?.descriptor.currentPhase !== null && 
            vm.activityState.descriptor.currentPhase.number == vm.designObj.phases.length;
    }

    vm.checkActivityFinished = function() {
        return vm.activityState.descriptor.status === "finished";        
    }

    vm.getUserCount = function(data) {
        return data.filter(user => !user.groupStatistics).length;
    };

    vm.init();
};