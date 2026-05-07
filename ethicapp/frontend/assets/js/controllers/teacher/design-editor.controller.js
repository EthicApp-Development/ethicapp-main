import designEditActions from "../../helpers/phase-edition-helpers.js";
import * as phaseValidationHelpers from "../../helpers/phase-validation-helpers.js"
import accordionStateHelpers from "../../helpers/accordeon-state-helpers.js"

export function DesignEditorController($scope, $translate, $timeout,
    $routeParams, DesignStateService, DesignCatalogService, CasesCatalogService, ExternalServicesCatalogService, toast) {

    const vm = this;
    vm.designId = 0;
    vm.design = null;
    vm.accordionState = {};
    
    vm.validationErrors = {
        global: [], // Global design-related errors
        phases: {}, // Specific per-phase errors
    };
    vm.associatedCase = null;
    vm.externalServices = [];
    
    vm.init = async function() {
        // Retrieve the design from the route path
        if ($routeParams.id !== undefined) {

            const designId = Number($routeParams.id);
            vm.designId = designId;

            const designObj = await DesignCatalogService.getDesignById(designId);
            vm.design = designObj;

            if (designObj === null) {
                console.error("[DesignEditorController::init] Design not found.");
                $scope.navigateTo("/error/404/2");
            }

            // Ensure the design is properly digested
            $scope.$applyAsync(() => {
                vm.design = designObj;
            });

            await DesignStateService.setDesign(designId, designObj);
            await vm.loadExternalServices();
            await vm.loadAssociatedCase();

            vm.initializeExternalServicesConfig();
            vm.initializeAccordionStates();
        }
    };

    vm.loadExternalServices = async function() {
        try {
            vm.externalServices = await ExternalServicesCatalogService.getServices();
        } catch (error) {
            console.error("[DesignEditorController::loadExternalServices] Error loading external services.", error);
            vm.externalServices = [];
        } finally {
            $scope.$applyAsync();
        }
    };

    vm.loadAssociatedCase = async function() {
        vm.associatedCase = null;
        if (!vm.designId) {
            return;
        }
        try {
            const response = await CasesCatalogService.getCaseByDesignId(vm.designId);
            vm.associatedCase = response;
            if (response && response.id) {
                vm.design.caseId = response.id;
                vm.selectedCase = vm.formatCaseLabel(response);
            } else {
                vm.design.caseId = null;
                vm.selectedCase = "";
            }
        } catch (error) {
            console.error("[DesignEditorController::loadAssociatedCase] Error loading associated case.", error);
            vm.design.caseId = null;
            vm.selectedCase = "";
        } finally {
            $scope.$applyAsync();
        }
    };

    vm.searchCases = async function(query) {
        return CasesCatalogService.searchCases(query);
    };

    vm.selectCase = function(caseItem) {
        if (!caseItem) {
            vm.design.caseId = null;
            vm.associatedCase = null;
            vm.selectedCase = "";
            return;
        }
        vm.design.caseId = caseItem.id;
        vm.associatedCase = caseItem;
        vm.selectedCase = vm.formatCaseLabel(caseItem);
    };

    vm.clearAssociatedCase = function() {
        vm.design.caseId = null;
        vm.associatedCase = null;
        vm.selectedCase = "";
    };

    vm.formatCaseLabel = function(caseItem) {
        if (!caseItem) {
            return "";
        }
        const hasAuthor = caseItem.authorFirstname || caseItem.authorLastname;
        if (hasAuthor) {
            return `${caseItem.title} (${caseItem.authorFirstname || ""} ${caseItem.authorLastname || ""})`.trim();
        }
        return caseItem.title;
    };

    vm.initializeAccordionStates = function () {
        vm.accordionState = {};
        try {
            vm.design.phases.forEach((_, index) => {
                vm.accordionState[index] = true;
            });
        } catch (error) {
            console.warn("The design does not appear to have any phases yet.");
        }
    };

    vm.toggleAccordionState = function (index, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        vm.accordionState[index] = !vm.accordionState[index];
    };

    vm.initializePhases = function(design) {
        try {
            vm.design.phases.forEach(vm.initPhase);
        } catch (error) {
            console.warn("The current design is probably invalid.");
        }
    };

    vm.initializeExternalServicesConfig = function() {
        try {
            vm.design.phases.forEach(vm.initExternalServicesConfig);
        } catch (error) {
            console.warn("The current design does not have phases to initialize external services.");
        }
    };

    vm.initPhase = function(phase) {
        $scope.$applyAsync(() => {
            designEditActions.initPhase(phase);
            vm.initExternalServicesConfig(phase);
        });
    };    

    vm.initExternalServicesConfig = function(phase) {
        if (!phase.externalServices) {
            phase.externalServices = { enabledServiceIds: [] };
        }
        if (!Array.isArray(phase.externalServices.enabledServiceIds)) {
            phase.externalServices.enabledServiceIds = [];
        }
    };

    vm.isExternalServiceEnabled = function(phase, serviceId) {
        vm.initExternalServicesConfig(phase);
        return phase.externalServices.enabledServiceIds.includes(serviceId);
    };

    vm.setExternalServiceEnabled = function(phase, serviceId, enabled) {
        vm.initExternalServicesConfig(phase);
        const enabledServiceIds = phase.externalServices.enabledServiceIds;
        const index = enabledServiceIds.indexOf(serviceId);

        if (enabled && index === -1) {
            enabledServiceIds.push(serviceId);
        }
        if (!enabled && index !== -1) {
            enabledServiceIds.splice(index, 1);
        }
    };

    vm.updatePhaseType = function(phase) {
        $scope.$applyAsync(() => {
            designEditActions.updatePhaseType(phase);
        });
    }

    vm.addPhase = function() { 
        const phase = designEditActions.buildBlankPhase(vm.design);
        $scope.$applyAsync(() => {
            designEditActions.addPhase(vm.design, phase);
            const numPhases = vm.design.phases.length;
            vm.accordionState[numPhases-1] = true;
        });
    };

    vm.addItemToPhase = function(phase) {
        const item = designEditActions.buildBlankItem(vm.design);
        console.debug(`[vm.addItemToPhase] ${JSON.stringify(item)}`);
        $scope.$applyAsync(() => {
            designEditActions.addPhaseItem(vm.design, phase, item);
        });
    };

    vm.duplicatePhase = function(phaseIndex, event = null) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        $scope.$applyAsync(() => {
            const state = vm.accordionState[phaseIndex];
            accordionStateHelpers.insertAccordionState(vm.accordionState, phaseIndex+1, state);
            designEditActions.clonePhaseByIndex(vm.design, phaseIndex);
        });
    };

    vm.removeItemFromPhase = function(phase, item) {
        designEditActions.removeItem(vm.design, phase, item);
    };

    vm.toggleAccordion = function (index) {
        vm.accordionState[index] = !vm.accordionState[index];
    };

    vm.isAccordionOpen = function (index) {
        return vm.accordionState[index] || false;
    };      

    vm.saveDesign = async function() {
        try {
            if (vm.design == null) {
                throw Error("Cannot save a null design");
            }
            await DesignCatalogService.updateDesign(vm.designId, vm.design);

            $scope.$applyAsync(() => {
                $translate("save_design_success").then((result) => {
                    toast.create({
                        timeout: 3 * 1000,
                        message: result,
                        containerClass: 'design-editor-toast-container',
                        dismissible: false,
                        defaultToastClass: 'toast',
                        insertFromTop: true,
                    });
                });
            });
        } catch (error) {
            $scope.$applyAsync(() => {
                $translate("save_design_failure").then((result) => {
                    toast.create({
                        timeout: 5 * 1000,
                        message: 'Failed to save design',
                        className: 'alert-danger',
                        dismissible: false,
                        containerClass: 'design-editor-toast-container',
                        defaultToastClass: 'toast',
                        insertFromTop: true
                    });
                });
            });
            console.error(error);
        }
    };

    vm.handleValidationResult = function (result) {    
        const { type, context, messages } = result;
        
        // Handle global errors
        if (type === "global") {
            console.debug(`[vm.handleValidationResult] global error handling`);
            if (messages.length > 0) {
                vm.validationErrors.global = messages;
            } else {
                vm.validationErrors.global = [];
            }
        }
    
        if (type === "phase") {
            const phaseKey = `phase_${context.phaseNumber}`;
    
            // Initialize the phase's error container if it doesn't exist
            if (!vm.validationErrors.phases[phaseKey]) {
                vm.validationErrors.phases[phaseKey] = {
                    items: {},          // For item/question errors
                    groupingConfig: [], // For grouping configuration errors
                    phaseInstructions: [], // For phase instructions errors
                    other: [],          // Other phase-related errors
                };
            }
    
            // Handle item (question/roles) errors
            if (context.itemNumber !== undefined) {
                const itemKey = `item_${context.itemNumber}`;
                if (messages.length > 0) {
                    vm.validationErrors.phases[phaseKey].items[itemKey] = messages;
                } else {
                    delete vm.validationErrors.phases[phaseKey].items[itemKey];
                }
            }
    
            // Handle grouping configuration errors
            if (context.groupingConfig) {
                if (messages.length > 0) {
                    vm.validationErrors.phases[phaseKey].groupingConfig = messages;
                } else {
                    vm.validationErrors.phases[phaseKey].groupingConfig = [];
                }
            }

            if (context.phaseInstructions) {
                if (messages.length > 0) {
                    vm.validationErrors.phases[phaseKey].phaseInstructions = messages;
                } else {
                    vm.validationErrors.phases[phaseKey].phaseInstructions = [];
                }
            }
    
            // Handle general phase errors
            if (!context.itemNumber && !context.groupingConfig && !context.phaseInstructions) {
                if (messages.length > 0) {
                    vm.validationErrors.phases[phaseKey].other = messages;
                } else {
                    vm.validationErrors.phases[phaseKey].other = [];
                }
            }
    
            // Clean up the phase key if there are no errors
            if (
                Object.keys(vm.validationErrors.phases[phaseKey].items).length === 0 &&
                vm.validationErrors.phases[phaseKey].groupingConfig.length === 0 &&
                vm.validationErrors.phases[phaseKey].phaseInstructions.length === 0 &&
                vm.validationErrors.phases[phaseKey].other.length === 0
            ) {
                delete vm.validationErrors.phases[phaseKey];
            }
        }

        // Update the design's validity flag
        if (vm.design) {
            vm.design.valid = vm.isDesignValid();
            if (!vm.design.valid) {
                vm.design.public = false;
            }
        }

        console.debug("Validation Errors:", JSON.stringify(vm.validationErrors));        
    };

    vm.isDesignValid = function() {
        let valid = true;

        if (vm.validationErrors.global && vm.validationErrors.global.length > 0) {
            // console.debug("[isDesignValid] The design has global errors.");
            valid = false;
        }
        if (vm.validationErrors.phases && Object.keys(vm.validationErrors.phases).length > 0) {
            // console.debug("[isDesignValid] The design has phase errors.");
            valid = false;
        }

        return valid;
    };

    vm.handleItemDeletion = function({ phaseNumber, deletedItem, index }) {
        console.log("[handleItemDeletion]");
    
        // Validate that phaseNumber is provided and valid
        if (phaseNumber === undefined || phaseNumber === null) {
            console.warn("[handleItemDeletion] phaseNumber is missing or invalid:", phaseNumber);
            return;
        }
    
        // Validate that index is provided and valid
        if (index === undefined || index === null || index < 0) {
            console.warn("[handleItemDeletion] index is missing or invalid:", index);
            return;
        }
    
        const phaseKey = `phase_${phaseNumber}`;
        const itemKey = `item_${index + 1}`;
    
        // Check that the validationErrors structure is initialized
        if (!vm.validationErrors || !vm.validationErrors.phases) {
            console.warn("[handleItemDeletion] Validation errors structure is not initialized.");
            return;
        }
    
        // Check if the phase exists in validationErrors
        if (!vm.validationErrors.phases[phaseKey]) {
            console.warn(`[handleItemDeletion] Phase key '${phaseKey}' does not exist in validationErrors.`);
            return;
        }
    
        // Ensure the items field is initialized within the phase
        if (!vm.validationErrors.phases[phaseKey].items) {
            console.warn(`[handleItemDeletion] Items for phase '${phaseKey}' are not initialized.`);
            return;
        }
    
        // Check if the specific item exists in the phase
        if (!vm.validationErrors.phases[phaseKey].items[itemKey]) {
            console.warn(`[handleItemDeletion] Item key '${itemKey}' does not exist in phase '${phaseKey}'.`);
            return;
        }
    
        $scope.$applyAsync(() => {
            // Remove validation errors associated with the deleted item
            delete vm.validationErrors.phases[phaseKey].items[itemKey];
            console.debug(`[handleItemDeletion] Validation errors for item '${itemKey}' in phase '${phaseKey}' deleted.`);
        
            // Update keys for subsequent items
            const itemKeys = Object.keys(vm.validationErrors.phases[phaseKey].items).sort();
            itemKeys.forEach((currentKey) => {
                const currentIndex = parseInt(currentKey.split('_')[1], 10);
                if (currentIndex > index + 1) {
                    const newKey = `item_${currentIndex - 1}`;
                    vm.validationErrors.phases[phaseKey].items[newKey] = vm.validationErrors.phases[phaseKey].items[currentKey];
                    delete vm.validationErrors.phases[phaseKey].items[currentKey];
                    console.debug(`[handleItemDeletion] Item key updated from '${currentKey}' to '${newKey}'.`);
                }
            });
        
            // Clean up the phase if it has no remaining errors
            const phaseErrors = vm.validationErrors.phases[phaseKey];
            if (
                Object.keys(phaseErrors.items).length === 0 &&
                phaseErrors.groupingConfig.length === 0 &&
                phaseErrors.other.length === 0
            ) {
                delete vm.validationErrors.phases[phaseKey];
                console.debug(`[handleItemDeletion] Phase '${phaseKey}' has no errors left and was removed.`);
            }
        });
    };

    vm.handlePhaseDeletion = function (deletedIndex) {
        console.debug(`[handlePhaseDeletion] Deleted phase at index: ${deletedIndex}`);
    
        const phaseKeyPrefix = 'phase_';

        // Remove the accordion state entry
        accordionStateHelpers.removeAccordionState(vm.accordionState, deletedIndex);
    
        $scope.$applyAsync(function() {
            // Removes errors associated with the deleted phase
            const phaseKey = `${phaseKeyPrefix}${deletedIndex + 1}`;
            if (vm.validationErrors.phases && vm.validationErrors.phases[phaseKey]) {
                delete vm.validationErrors.phases[phaseKey];
                console.debug(`[handlePhaseDeletion] Removed validation errors for ${phaseKey}`);
                console.debug(`[handlePhaseDeletion] validation errors ${JSON.stringify(vm.validationErrors.phases)}`);
            }
        
            // Updates the keys of the remaining phases
            if (vm.validationErrors.phases) {
                const updatedPhases = {};
                Object.keys(vm.validationErrors.phases).forEach((key) => {
                    const phaseNumber = parseInt(key.split('_')[1], 10);
                    if (phaseNumber > deletedIndex + 1) {
                        const newPhaseKey = `${phaseKeyPrefix}${phaseNumber - 1}`;
                        updatedPhases[newPhaseKey] = vm.validationErrors.phases[key];
                        console.debug(`[handlePhaseDeletion] Updated phase key: ${key} -> ${newPhaseKey}`);
                    } else {
                        updatedPhases[key] = vm.validationErrors.phases[key];
                    }
                });
                console.debug(`[handlePhaseDeletion] validation errors post update ${JSON.stringify(vm.validationErrors.phases)}`);
                vm.validationErrors.phases = updatedPhases;
            }
        });
    };

    vm.handlePhaseMove = function ({ fromIndex, toIndex }) {
        console.log(`[handlePhaseMove] Moving phase from ${fromIndex + 1} to ${toIndex + 1}`);
    
        const fromPhaseKey = `phase_${fromIndex + 1}`;
        const toPhaseKey = `phase_${toIndex + 1}`;

        // Move the accordion state entry accordingly
        const up = fromIndex - toIndex > 0;
        if (up) {
            accordionStateHelpers.moveAccordionStateUp(vm.accordionState, fromIndex);
        } else {
            accordionStateHelpers.moveAccordionStateDown(vm.accordionState, fromIndex);
        }

        // Ensure validationErrors and phases exist
        if (!vm.validationErrors || !vm.validationErrors.phases) {
            console.warn("[handlePhaseMove] validationErrors or phases structure is not initialized.");
            return;
        }
    
        $scope.$applyAsync(function () {
            // Case 1: Both phases exist in validationErrors
            if (vm.validationErrors.phases[fromPhaseKey] && vm.validationErrors.phases[toPhaseKey]) {
                const temp = vm.validationErrors.phases[fromPhaseKey];
                vm.validationErrors.phases[fromPhaseKey] = vm.validationErrors.phases[toPhaseKey];
                vm.validationErrors.phases[toPhaseKey] = temp;
                console.debug(`[handlePhaseMove] Swapped validation errors for phases ${fromPhaseKey} and ${toPhaseKey}.`);
            }
            // Case 2: Only the "from" phase exists in validationErrors
            else if (vm.validationErrors.phases[fromPhaseKey] && !vm.validationErrors.phases[toPhaseKey]) {
                vm.validationErrors.phases[toPhaseKey] = vm.validationErrors.phases[fromPhaseKey];
                delete vm.validationErrors.phases[fromPhaseKey];
                console.debug(`[handlePhaseMove] Moved validation errors from ${fromPhaseKey} to ${toPhaseKey}.`);
            }
            // Case 3: Only the "to" phase exists in validationErrors
            else if (!vm.validationErrors.phases[fromPhaseKey] && vm.validationErrors.phases[toPhaseKey]) {
                vm.validationErrors.phases[fromPhaseKey] = vm.validationErrors.phases[toPhaseKey];
                delete vm.validationErrors.phases[toPhaseKey];
                console.debug(`[handlePhaseMove] Moved validation errors from ${toPhaseKey} to ${fromPhaseKey}.`);
            }
            // Case 4: Neither phase exists in validationErrors
            else {
                console.debug("[handlePhaseMove] Neither phase has validation errors. No updates needed.");
            }
        });
    };

    vm.handleItemMove = function ({ phaseNumber, fromIndex, toIndex }) {
        console.log(`[DesignEditorController::handleItemMove] ${phaseNumber} ${fromIndex} ${toIndex}`);
        
        const phaseKey = `phase_${phaseNumber}`;
        const fromItemKey = `item_${fromIndex + 1}`;
        const toItemKey = `item_${toIndex + 1}`;
        
        $scope.$applyAsync(function() {
            // Case 1: Both items exist in validationErrors
            const phaseErrors = vm.validationErrors.phases[phaseKey];
            if (phaseErrors && phaseErrors.items[fromItemKey] && phaseErrors.items[toItemKey]) {
                const temp = phaseErrors.items[fromItemKey];
                phaseErrors.items[fromItemKey] = phaseErrors.items[toItemKey];
                phaseErrors.items[toItemKey] = temp;
                console.debug(
                    `[handleItemMove] Swapped validation errors for items ${fromItemKey} and ${toItemKey} in phase ${phaseNumber}.`);
            }
            // Case 2: Only the "from" item exists in validationErrors
            else if (phaseErrors && !phaseErrors.items[toItemKey]) {
                phaseErrors.items[toItemKey] = phaseErrors.items[fromItemKey];
                delete phaseErrors.items[fromItemKey];
                console.debug(`[handleItemMove] Moved validation errors from ${fromItemKey} to ${toItemKey} in phase ${phaseNumber}.`);
            }
            // Case 3: Only the "to" item exists in validationErrors
            else if (!phaseErrors.items[fromItemKey] && phaseErrors.items[toItemKey]) {
                phaseErrors.items[fromItemKey] = phaseErrors.items[toItemKey];
                delete phaseErrors.items[toItemKey];
                console.debug(`[handleItemMove] Moved validation errors from ${toItemKey} to ${fromItemKey}.`);        }

            // Case 4: Neither phase exists in validationErrors
            else {
                console.debug("[handleItemMove] Neither phase has validation errors. No updates needed.");
            }
        });
    };

    vm.handleItemDeletion = function ({ phaseNumber, deletedIndex }) {
        console.debug(
            `[handleItemDeletion] Deleted item at index: ${deletedIndex}, phase ${phaseNumber}`);
    
        const phaseKeyPrefix = "phase_";
        const phaseKey = `${phaseKeyPrefix}${phaseNumber}`;
        const itemKey = `item_${deletedIndex+1}`;

        $scope.$applyAsync(function() {
            // Removes errors associated with the deleted phase
            const phaseErrors = vm.validationErrors.phases[phaseKey];
            if (phaseErrors && phaseErrors.items[itemKey]) {
                delete phaseErrors.items[itemKey];

                if (Object.keys(phaseErrors.items).length == 0) {
                    delete phaseErrors.items;
                }

                const phaseValid = phaseValidationHelpers.isPhaseValid(phaseErrors);
                
                if (phaseValid) {
                    delete vm.validationErrors.phases[phaseKey];

                    console.debug(`[handleItemDeletion] Removed validation errors for ${phaseKey}`);
                    console.debug(
                        `[handleItemDeletion] No further operations are required for ${phaseKey}, deleting it from validation errors.`);
                    
                    // No further updates are required
                    return;
                }
    
                console.debug(`[handleItemDeletion] validation errors ${JSON.stringify(vm.validationErrors.phases)}`);
            }
        
            // Updates the keys of the remaining items
            if (phaseErrors.items) {
                const updatedItems = {};
                Object.keys(phaseErrors.items).forEach((key) => {
                    const itemNumber = parseInt(key.split('_')[1], 10);
                    if (itemNumber > deletedIndex + 1) {
                        const newItemKey = `${phaseKeyPrefix}${itemNumber - 1}`;
                        updatedItems[newItemKey] = phaseErrors.items[key];
                        console.debug(`[handleItemDeletion] Updated phase key: ${key} -> ${newItemKey}`);
                    } else {
                        updatedItems[key] = phaseErrors.items[key];
                    }
                });
                console.debug(`[handleItemDeletion] validation errors post update ${JSON.stringify(phaseErrors.items)}`);
                phaseErrors.items = updatedItems;
            }
        });
    };

    vm.getSortedPhaseErrorKeys = function () {
        return Object.keys(vm.validationErrors.phases).sort((a, b) => {
            const phaseNumberA = parseInt(a.split('_')[1], 10);
            const phaseNumberB = parseInt(b.split('_')[1], 10);
            return phaseNumberA - phaseNumberB;
        });
    };    
   
    vm.scrollToPhase = function (phaseKey) {
        const elementId = phaseKey;
        const element = document.getElementById(elementId);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };    
    
    vm.init();
}
