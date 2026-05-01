import * as PhaseCreationHelpers from "../../helpers/phase-creation-helpers.js";
import * as DesignHelpers from "../../helpers/design-helpers.js";
import { DashboardDataJoiners } from "../../helpers/dashboard-data-joiners.js";
import { openSemanticDifferentialIndividualResponseModal } from "../../helpers/dashboard-individual-response-modal.helper.js";
import { openSemanticDifferentialGroupResponseModal } from "../../helpers/dashboard-group-response-modal.helper.js";

/*eslint func-style: ["error", "expression"]*/
export function DashboardController($scope, $routeParams, $http, 
    $translate, $timeout, $uibModal, 
    ActivityStateService, ActivityCatalogService, DesignCatalogService, TeacherGroupChatService) {

    const vm = this;

    vm.designObj = null;
    vm.userList = [];
    vm.reachedLastPhase = false;
    vm.dashboardPhaseData = [];
    vm.dashboardPhaseUpdateState = new Map();
    
    vm.selectedTab = 0; // Default to the first tab

    vm.selectTab = function(index) {
        vm.selectedTab = index; // Update the selected tab index
    };

    vm.openIndividualResponseModal = function(response, phaseData) {
        if (!response || !phaseData || vm.designObj?.type !== "semantic_differential") {
            return;
        }

        const hydratedPhaseData = vm.hydratePhaseDataForIndividualModal(phaseData);
        openSemanticDifferentialIndividualResponseModal($uibModal, response, hydratedPhaseData);
    };

    vm.openGroupResponseModal = async function(group, phaseData) {
        if (!group?.groupStatistics || !group.groupId || !phaseData || vm.designObj?.type !== "semantic_differential") {
            return;
        }

        const hydratedPhaseData = vm.hydratePhaseDataForIndividualModal(phaseData);
        const phaseId = hydratedPhaseData?.descriptor?.id;
        const firstQuestionId = hydratedPhaseData?.descriptor?.questions?.[0]?.id;

        if (!phaseId || !firstQuestionId) {
            return;
        }

        try {
            const [responses, chatMessages] = await Promise.all([
                ActivityStateService.getGroupResponses(group.groupId, phaseId),
                ActivityStateService.getChatMessages(group.groupId, firstQuestionId),
            ]);

            openSemanticDifferentialGroupResponseModal(
                $uibModal,
                TeacherGroupChatService,
                group,
                hydratedPhaseData,
                responses,
                chatMessages,
                vm.canUseLiveGroupChat(hydratedPhaseData)
            );
        } catch (error) {
            console.error("Error opening group response modal:", error);
        }
    };

    vm.canUseLiveGroupChat = function(phaseData) {
        const phaseDescriptor = phaseData?.descriptor;
        const currentPhaseId = vm.activityState?.descriptor?.currentPhase?.id;
        const activityStatus = vm.activityState?.descriptor?.status;
        const isFinishedStatus = activityStatus === "finished" || Number(activityStatus) === 3;

        return Boolean(vm.isChatEnabledForPhase(phaseDescriptor))
            && Number(phaseDescriptor?.id) === Number(currentPhaseId)
            && !isFinishedStatus;
    };

    vm.getDesignPhaseForDescriptor = function(phaseDescriptor) {
        const designPhases = vm.designObj?.phases || [];
        const phaseNumber = Number(phaseDescriptor?.number);

        return designPhases.find((phase, index) => {
            const designPhaseNumber = Number(phase?.number || index + 1);
            return designPhaseNumber === phaseNumber;
        }) || designPhases[phaseNumber - 1] || null;
    };

    vm.isChatEnabledForPhase = function(phaseDescriptor) {
        if (typeof phaseDescriptor?.chat === "boolean") {
            return phaseDescriptor.chat;
        }

        return vm.getDesignPhaseForDescriptor(phaseDescriptor)?.chat === true;
    };

    vm.hydratePhaseDataForIndividualModal = function(phaseData) {
        const descriptor = phaseData?.descriptor;
        const descriptorQuestions = descriptor?.questions || [];

        if (!descriptor || descriptorQuestions.length === 0) {
            return phaseData;
        }

        const phaseIndex = Number(descriptor.number) - 1;
        const designPhase = vm.getDesignPhaseForDescriptor(descriptor) || vm.designObj?.phases?.[phaseIndex];
        const designQuestions = designPhase?.questions || [];

        if (designQuestions.length === 0) {
            return {
                ...phaseData,
                descriptor: {
                    ...descriptor,
                    chat: vm.isChatEnabledForPhase(descriptor),
                },
            };
        }

        const mergedQuestions = descriptorQuestions.map((question, index) => {
            const descriptorNumber = Number(question?.number || question?.order || index + 1);
            const matchedDesignQuestion =
                designQuestions.find((dq) => Number(dq?.number || dq?.order || 0) === descriptorNumber)
                || designQuestions.find((dq) => Number(dq?.id || 0) === Number(question?.id || 0))
                || designQuestions[index]
                || {};

            const mergedAnsFormat = {
                ...(matchedDesignQuestion?.ans_format || {}),
                ...(question?.ans_format || {}),
            };

            return {
                ...matchedDesignQuestion,
                ...question,
                ans_format: mergedAnsFormat,
                q_text: question?.q_text || matchedDesignQuestion?.q_text || null,
                text: question?.text || matchedDesignQuestion?.q_text || matchedDesignQuestion?.text || null,
                leftPole: question?.leftPole || mergedAnsFormat?.l_pole || matchedDesignQuestion?.leftPole || null,
                rightPole: question?.rightPole || mergedAnsFormat?.r_pole || matchedDesignQuestion?.rightPole || null,
                range: Number(question?.range || mergedAnsFormat?.values || matchedDesignQuestion?.range || 0),
                justify: typeof question?.justify === "boolean"
                    ? question.justify
                    : Boolean(mergedAnsFormat?.just_required),
            };
        });

        return {
            ...phaseData,
            descriptor: {
                ...descriptor,
                chat: vm.isChatEnabledForPhase(descriptor),
                questions: mergedQuestions,
            },
        };
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
                return null;
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
                return null;
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
            await vm.updateDashboardPhaseData(phaseId);
            return phaseId;
        } catch (error) {
            console.error("Error in startNextPhase:", error);
            return null;
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
        const updateKey = Number(phaseId);
        const updateState = vm.dashboardPhaseUpdateState.get(updateKey) || {
            inProgress: false,
            queued: false,
        };

        if (updateState.inProgress) {
            updateState.queued = true;
            vm.dashboardPhaseUpdateState.set(updateKey, updateState);
            return;
        }

        updateState.inProgress = true;
        updateState.queued = false;
        vm.dashboardPhaseUpdateState.set(updateKey, updateState);

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
        } finally {
            const latestUpdateState = vm.dashboardPhaseUpdateState.get(updateKey);
            if (latestUpdateState?.queued) {
                latestUpdateState.inProgress = false;
                latestUpdateState.queued = false;
                vm.dashboardPhaseUpdateState.set(updateKey, latestUpdateState);
                vm.updateDashboardPhaseData(phaseId);
                return;
            }

            vm.dashboardPhaseUpdateState.delete(updateKey);
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
                if (typeof builderSteps.addExternalGroupChatInfo === "function") {
                    phaseState = builderSteps.addExternalGroupChatInfo(
                        phaseState,
                        chatMessageCount,
                        phaseDescriptor.questions
                    );
                }
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

    vm.studentJoinHandler = function () {
        if (!vm.activityState || vm.checkActivityFinished()) {
            return;
        }

        const users = Array.isArray(vm.activityState.users) ? vm.activityState.users : [];
        const currentPhaseId = vm?.activityState?.descriptor?.currentPhase?.id;

        $scope.$applyAsync(() => {
            vm.userList = users;
        });

        if (currentPhaseId) {
            vm.updateDashboardPhaseData(currentPhaseId);
        }
    };

    vm.defaultEventHandler = function (data) {
        const phaseId = data?.phaseId || data?.response?.phaseId || vm?.activityState?.descriptor?.currentPhase?.id;
        if (!phaseId) {
            console.warn("Unable to resolve the phase to refresh");
            return;
        }
        vm.updateDashboardPhaseData(phaseId);
    };

    vm.activatePhaseTabById = function(phaseId, retryCount = 8) {
        const phaseIndex = vm.dashboardPhaseData.findIndex((phase) => phase?.descriptor?.id == phaseId);
        if (phaseIndex >= 0) {
            vm.selectedTab = phaseIndex;
            return;
        }

        if (retryCount <= 0) {
            vm.selectedTab = vm.dashboardPhaseData.length - 1;
            return;
        }

        $timeout(() => vm.activatePhaseTabById(phaseId, retryCount - 1), 100);
    };

    $scope.$on("activity:phase-advanced", (event, data) => {
        vm.activeTab = "info";
        const phaseId = data?.phaseId;
        if (phaseId) {
            vm.activatePhaseTabById(phaseId);
            return;
        }

        if (vm.dashboardPhaseData.length > 0) { 
            $timeout(() => {
                vm.selectedTab = vm.dashboardPhaseData.length - 1;
            }, 0);
        }
    });

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
