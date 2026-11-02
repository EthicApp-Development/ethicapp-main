import * as DesignHelpers from "../../helpers/design-helpers.js";
import { DashboardDataJoiners } from "../../helpers/dashboard-data-joiners.js";
import {
    phaseEnabledServiceIds,
    serviceDisplayName,
} from "../../helpers/service-configuration-summary.js";
import { connectedStudentCount } from "../../helpers/activity-bar.js";
import { activityDocumentTitleKeeper } from "../../helpers/activity-title.js";
import {
    DEFAULT_DASHBOARD_TAB,
    aiServicesTurnedOff,
    dashboardTab,
    defaultPhaseContextExpanded,
    defaultSelectedPhaseId,
    isOneColumnLayout,
    participantMatchCount,
    phaseQuestionTexts,
    phaseResponseCounts,
    resolveSelectedPhaseId,
    selectedPhaseData,
    watchOneColumnLayout,
} from "../../helpers/activity-dashboard.js";
import {
    adjacentDetailRow,
    detailRows,
    detailSelection,
    findDetailRow,
} from "../../helpers/response-detail.js";
import { hiddenNamePhase, pseudonymNumberMap } from "../../helpers/hidden-names.js";

/*eslint func-style: ["error", "expression"]*/
export function DashboardController($scope, $routeParams, $http,
    $translate, $timeout,
    ActivityStateService, ActivityCatalogService, DesignCatalogService, CasesCatalogService,
    LanguageCatalogService, $window) {

    const vm = this;

    vm.designObj = null;
    vm.associatedCase = null;
    vm.userList = [];
    vm.reachedLastPhase = false;
    vm.dashboardPhaseData = [];
    vm.dashboardPhaseUpdateState = new Map();

    // Two-column layout (#894, epic #892): the main tab, the phase selected
    // in the navigator (null until one is chosen), the participant search,
    // and the rail cards' open state. "This phase" starts collapsed to its
    // questions below 1600 px; "Activity" starts collapsed.
    vm.mainTab = DEFAULT_DASHBOARD_TAB;
    vm.selectedPhaseId = null;
    vm.participantQuery = "";
    vm.phaseContextExpanded = defaultPhaseContextExpanded($window.innerWidth);
    vm.activityCardExpanded = false;
    // True once the started phases are read, so the "start the activity"
    // notice does not flash while they load.
    vm.phaseDataLoaded = false;

    // One column below 1200 px (#895): the phases as pills above the main
    // tabs and the rail's cards as sections under the main column, "This
    // phase" and "AI services" collapsed. The layout follows the window
    // without a reload; the selected phase, tab and search stay as they are.
    vm.isOneColumn = isOneColumnLayout($window);
    vm.phaseSectionOpen = false;
    vm.servicesSectionOpen = false;
    const stopWatchingLayout = watchOneColumnLayout($window, isOneColumn => {
        $scope.$applyAsync(() => {
            vm.isOneColumn = isOneColumn;
        });
    });
    $scope.$on("$destroy", stopWatchingLayout);

    // The response detail panel (#896): what it shows (see
    // helpers/response-detail.js), or null while it is closed. It closes
    // when the teacher starts the next phase, selects another phase or
    // leaves the responses; nothing of it is kept.
    vm.detail = null;
    // Each phase's data with its questions merged with the design's, worked
    // out once per phase data so the panel's bindings settle.
    const detailPhaseDataByPhase = new WeakMap();
    // Each design phase's question texts, worked out once per phase so the
    // tables' bindings keep the same array between digests.
    const questionTextsByDesignPhase = new WeakMap();

    // "Hide names" (#897): while it is on, every student is shown by a
    // pseudonym (helpers/hidden-names.js). It always starts off and is not
    // remembered, so a reload turns it off; it only changes the display.
    // The pseudonym numbers are read when it is turned on, and again when a
    // student joins while it is on.
    vm.namesHidden = false;
    let pseudonymNumbers = new Map();
    // Grows with every set of numbers read, so the phases shown with hidden
    // names are worked out again.
    let pseudonymsVersion = 0;
    let pseudonymsRequest = 0;
    // Each phase's data as it shows with hidden names, worked out once per
    // phase data, numbers and language so the tables' bindings settle.
    const hiddenNamePhases = new WeakMap();

    // Services the design enables that will not run in this activity, shown
    // once right after launch (#815).
    vm.servicesNotRunning = [];

    // Titles the browser tab by the activity once the dashboard knows it.
    let documentTitle = null;

    // A service's name in the UI language, or its id without one.
    vm.serviceNotRunningName = function(service) {
        return serviceDisplayName(service, LanguageCatalogService.getCurrentUiLanguageCode())
            || service?.id;
    };

    vm.dismissServicesNotRunning = function() {
        vm.servicesNotRunning = [];
    };

    vm.hasAssociatedCaseTab = function() {
        return Boolean(vm.associatedCase);
    };

    vm.selectMainTab = function(tab) {
        vm.mainTab = dashboardTab(tab);
        if (vm.mainTab !== DEFAULT_DASHBOARD_TAB) {
            vm.closeResponseDetail();
        }
    };

    vm.isMainTabSelected = function(tab) {
        return vm.mainTab === tab;
    };

    vm.currentPhaseId = function() {
        return vm.activityState?.descriptor?.currentPhase?.id ?? null;
    };

    // Selects a started phase in the navigator: the rail's phase context and
    // the responses table follow it.
    vm.selectPhaseById = function(phaseId) {
        if (selectedPhaseData(vm.dashboardPhaseData, phaseId)) {
            if (Number(phaseId) !== Number(vm.selectedPhaseId)) {
                vm.closeResponseDetail();
            }
            vm.selectedPhaseId = phaseId;
        }
    };

    vm.selectPhaseTab = function(phaseData) {
        vm.selectPhaseById(phaseData?.descriptor?.id);
    };

    vm.isPhaseTabSelected = function(phaseData) {
        return vm.selectedPhaseId !== null
            && Number(phaseData?.descriptor?.id) === Number(vm.selectedPhaseId);
    };

    // The current phase, or the last one started; keeps a phase the teacher
    // selected while it is still listed.
    vm.selectDefaultProgressTab = function() {
        vm.selectedPhaseId = resolveSelectedPhaseId(vm.selectedPhaseId, vm.dashboardPhaseData,
            vm.currentPhaseId());
    };

    // The selected phase as the dashboard shows it: with hidden names while
    // the switch is on.
    vm.selectedPhase = function() {
        return vm.displayPhase(selectedPhaseData(vm.dashboardPhaseData, vm.selectedPhaseId));
    };

    const translateInstant = function(key, params) {
        return typeof $translate?.instant === "function" ? $translate.instant(key, params) : key;
    };

    const currentLanguage = function() {
        return typeof $translate?.use === "function" ? $translate.use() : "";
    };

    // A started phase's data as the tables and the panel show it: the phase
    // itself while names show; while they are hidden, a copy whose students
    // are named and ordered by pseudonym. The same object on every call
    // until the phase, the numbers or the language change.
    vm.displayPhase = function(phaseData) {
        if (!vm.namesHidden || !phaseData || typeof phaseData !== "object") {
            return phaseData;
        }
        const signature = `${pseudonymsVersion}|${currentLanguage()}`;
        const cached = hiddenNamePhases.get(phaseData);
        if (cached?.signature === signature) {
            return cached.phase;
        }
        const phase = hiddenNamePhase(phaseData, {
            numbers:   pseudonymNumbers,
            translate: translateInstant,
        });
        hiddenNamePhases.set(phaseData, { signature, phase });
        return phase;
    };

    // The students' numbers, for the Participants tab.
    vm.pseudonymNumbers = function() {
        return pseudonymNumbers;
    };

    // Reads the students' numbers; the server assigns one to every student
    // who has none yet. Only the latest read counts; a failed read keeps the
    // numbers already known.
    vm.loadPseudonyms = async function() {
        if (!vm.sessionId) {
            return;
        }
        const request = ++pseudonymsRequest;
        try {
            const pseudonyms = await ActivityStateService.getParticipantPseudonyms(vm.sessionId);
            $scope.$applyAsync(() => {
                if (request === pseudonymsRequest) {
                    pseudonymNumbers = pseudonymNumberMap(pseudonyms);
                    pseudonymsVersion += 1;
                }
            });
        } catch (error) {
            console.error("[DashboardController::loadPseudonyms] Cannot read the pseudonyms.",
                error);
        }
    };

    // The switch changed: the numbers are read again each time it turns on.
    vm.onNamesHiddenChange = function() {
        if (vm.namesHidden) {
            vm.loadPseudonyms();
        }
    };

    // The design's entry for the selected phase: its features, instructions
    // and external services.
    vm.selectedDesignPhase = function() {
        const phase = vm.selectedPhase();
        return phase ? vm.getDesignPhaseForDescriptor(phase.descriptor) : null;
    };

    vm.selectedPhaseServiceCount = function() {
        return phaseEnabledServiceIds(vm.selectedDesignPhase()).length;
    };

    vm.selectedPhaseHasServices = function() {
        return vm.selectedPhaseServiceCount() > 0;
    };

    // Launched with its AI services turned off (#970): the "AI services"
    // card says so instead of describing the phase's services.
    vm.aiServicesTurnedOff = function() {
        return aiServicesTurnedOff(vm.activityState?.descriptor);
    };

    // The text of each question of a started phase, for the response table's
    // column headers (#895). The same array on every call for a phase.
    vm.questionTexts = function(phaseDescriptor) {
        const designPhase = vm.getDesignPhaseForDescriptor(phaseDescriptor);
        if (!designPhase || typeof designPhase !== "object") {
            return null;
        }
        if (!questionTextsByDesignPhase.has(designPhase)) {
            questionTextsByDesignPhase.set(designPhase, phaseQuestionTexts(designPhase));
        }
        return questionTextsByDesignPhase.get(designPhase);
    };

    vm.selectedPhaseCounts = function() {
        return phaseResponseCounts(vm.selectedPhase());
    };

    vm.selectedPhaseMatchCount = function() {
        return participantMatchCount(vm.selectedPhase(), vm.participantQuery);
    };

    vm.hasParticipantQuery = function() {
        return typeof vm.participantQuery === "string" && vm.participantQuery.trim() !== "";
    };

    vm.clearParticipantQuery = function() {
        vm.participantQuery = "";
    };

    vm.studentCount = function() {
        return connectedStudentCount(vm.userList);
    };

    vm.togglePhaseContext = function() {
        vm.phaseContextExpanded = !vm.phaseContextExpanded;
    };

    vm.toggleActivityCard = function() {
        vm.activityCardExpanded = !vm.activityCardExpanded;
    };

    vm.togglePhaseSection = function() {
        vm.phaseSectionOpen = !vm.phaseSectionOpen;
    };

    vm.toggleServicesSection = function() {
        vm.servicesSectionOpen = !vm.servicesSectionOpen;
    };

    vm.loadAssociatedCase = async function(designId) {
        if (!designId) {
            return null;
        }

        try {
            if (vm.designObj?.associatedCase?.id) {
                const associatedCase = vm.designObj.associatedCase;
                const hasDocumentPayload = associatedCase.pdfPath
                    || associatedCase.documentProcessing
                    || Array.isArray(associatedCase.representations)
                    || Array.isArray(associatedCase.renderedImages)
                    || associatedCase.documentRepresentation;

                if (hasDocumentPayload) {
                    return associatedCase;
                }

                return await CasesCatalogService.getCaseById(associatedCase.id);
            }

            return await CasesCatalogService.getCaseByDesignId(designId);
        } catch (error) {
            console.error("[DashboardController::loadAssociatedCase] Error loading associated case.", error);
            return null;
        }
    };

    // Opens the response detail panel on a row of a phase's table: a
    // student's answers, or a group's answers and chat. Only
    // semantic-differential designs have a detail. Another row replaces the
    // panel's content.
    vm.openResponseDetail = function(row, phaseData, options = {}) {
        if (vm.designObj?.type !== "semantic_differential") {
            return;
        }
        const selection = detailSelection(row, phaseData, options);
        if (selection) {
            vm.detail = selection;
        }
    };

    vm.closeResponseDetail = function() {
        vm.detail = null;
    };

    vm.isResponseDetailOpen = function() {
        return vm.detail !== null && vm.detailRow() !== null;
    };

    // The phase the panel shows, while it is the selected one.
    const detailPhase = function() {
        const phase = vm.selectedPhase();
        return vm.detail && phase && Number(phase.descriptor?.id) === Number(vm.detail.phaseId)
            ? phase
            : null;
    };

    // The panel's row of the live table, so new answers show at once. The
    // whole table is searched: a row the participant search hides stays open.
    vm.detailRow = function() {
        return findDetailRow(detailPhase()?.state, vm.detail?.key);
    };

    vm.detailPhaseData = function() {
        const phase = detailPhase();
        if (!phase) {
            return null;
        }
        if (!detailPhaseDataByPhase.has(phase)) {
            detailPhaseDataByPhase.set(phase, vm.hydratePhaseDataForDetail(phase));
        }
        return detailPhaseDataByPhase.get(phase);
    };

    vm.detailCanUseLiveChat = function() {
        const phaseData = vm.detailPhaseData();
        return Boolean(phaseData) && vm.canUseLiveGroupChat(phaseData);
    };

    // The row before (-1) or after (1) the panel's, in the table's order.
    const adjacentRow = function(step) {
        const rows = detailRows(detailPhase(), vm.participantQuery);
        return adjacentDetailRow(rows, vm.detail?.key, step);
    };

    vm.detailHasAdjacent = function(step) {
        return adjacentRow(step) !== null;
    };

    vm.navigateResponseDetail = function(step) {
        const row = adjacentRow(step);
        if (row) {
            vm.openResponseDetail(row, detailPhase());
        }
    };

    // From a student's panel to the student's group, on its chat.
    vm.openGroupResponseDetail = function(group) {
        vm.openResponseDetail(group, detailPhase(), { initialTab: "chat" });
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

    vm.hydratePhaseDataForDetail = function(phaseData) {
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

        // The responses come first (#894).
        vm.mainTab = DEFAULT_DASHBOARD_TAB;

        vm.servicesNotRunning = ActivityCatalogService.takeLaunchNotice(vm.sessionId);

        // The browser tab shows the activity's name and description while
        // the dashboard is open (#973), and its own title again after.
        documentTitle = activityDocumentTitleKeeper($window.document);
        $scope.$on("$destroy", () => documentTitle.restore());

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

    // Starts the next phase on the server (#906), which builds it from the
    // stored design in one transaction. Resolves to the phase the dashboard
    // should show: the new one, or, when another tab or request moved the
    // activity first (409), the phase it is at now. Null when there is none.
    vm.startNextPhase = async function () {
        const expectedPhaseNumber = vm.activityState.descriptor.currentPhase?.number ?? 0;

        let phaseId = null;
        try {
            const phase = await ActivityStateService.startNextPhase(vm.sessionId,
                expectedPhaseNumber);
            phaseId = phase.id;
        } catch (error) {
            if (error?.status !== 409) {
                console.error("Error in startNextPhase:", error);
                return null;
            }
            console.warn("The activity moved on before this phase started; showing where it is.",
                error.data);
            phaseId = vm.activityState.descriptor.currentPhase?.id ?? null;
        }

        vm.isActivityFinished = vm.checkActivityFinished();
        $scope.$applyAsync(() => {
            vm.reachedLastPhase = vm.lastPhaseReached();
        });

        if (phaseId) {
            await vm.updateDashboardPhaseData(phaseId);
        }
        return phaseId;
    };

    vm.initializeDashboardState = async function() {
        try {
            // Load the entire activity state
            vm.activityState = await ActivityStateService.loadActivityState(vm.sessionId);
            vm.userList = vm.activityState?.users ?? [];
            documentTitle?.show(vm.activityState?.descriptor);
                    
            // Get the design of the activity
            vm.designObj = await DesignCatalogService.getDesignById(vm.activityState.descriptor.designId)
                || {
                    ...vm.activityState.descriptor.design,
                    id: vm.activityState.descriptor.designId,
                    userOwned: true,
                };
            vm.associatedCase = await vm.loadAssociatedCase(vm.activityState.descriptor.designId);
            if (vm.designObj) {
                vm.designObj.associatedCase = vm.associatedCase;
            }
    
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
                vm.phaseDataLoaded = true;
                vm.selectDefaultProgressTab();
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
                        // A queued update may have loaded the phase too: the
                        // views track the phases by id, so keep one entry.
                        const loaded = vm.dashboardPhaseData
                            .findIndex(pd => Number(pd.descriptor.id) === Number(phaseId));
                        if (loaded >= 0) {
                            vm.dashboardPhaseData[loaded] = phaseData;
                        } else {
                            vm.dashboardPhaseData.push(phaseData);
                        }
                        vm.selectDefaultProgressTab();
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

    vm.openActivityReports = function() {
        $scope.navigateTo(`/activities/${vm.sessionId}/reports`);
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

        // While names are hidden, the student who joined gets a number.
        if (vm.namesHidden) {
            vm.loadPseudonyms();
        }

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
            vm.selectPhaseTab(vm.dashboardPhaseData[phaseIndex]);
            return;
        }

        if (retryCount <= 0) {
            vm.selectPhaseById(defaultSelectedPhaseId(vm.dashboardPhaseData, vm.currentPhaseId()));
            return;
        }

        $timeout(() => vm.activatePhaseTabById(phaseId, retryCount - 1), 100);
    };

    // Starting the next phase always moves the view to it, on the responses
    // (#894). The event comes after an await, outside a digest.
    $scope.$on("activity:phase-advanced", (event, data) => {
        const phaseId = data?.phaseId;
        $scope.$applyAsync(() => {
            // The previous phase's chat closes for the students; the panel
            // closes with it (#896).
            vm.closeResponseDetail();
            vm.selectMainTab(DEFAULT_DASHBOARD_TAB);
            vm.activatePhaseTabById(phaseId || vm.currentPhaseId(), phaseId ? 8 : 0);
        });
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
