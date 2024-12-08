import designEditActions from "../../helpers/phase-edition-helpers.js";
import { getPhaseByIndex } from "../../helpers/design-helpers.js";

export function DesignEditorController($scope, $routeParams, 
    DesignStateService, DesignCatalogService) {

    const vm = this;
    vm.designId = 0;
    vm.design = null;
    vm.accordionState = {};

    vm.validationErrors = {
        global: [], // Global design-related errors
        phases: {}, // Specific per-phase errors
    };
    
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

            //vm.initializePhases();
            vm.initializeAccordionStates();
        }
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

    vm.initPhase = function(phase) {
        $scope.$applyAsync(() => {
            designEditActions.initPhase(phase);
        });
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
            designEditActions.clonePhaseByIndex(vm.design, phaseIndex);
        });
    };

    vm.removeItemFromPhase = function(phase, item) {
        designEditActions.removePhase(vm.design, phase, item);
    };

    vm.toggleAccordion = function (index) {
        vm.accordionState[index] = !vm.accordionState[index];
    };

    vm.isAccordionOpen = function (index) {
        return vm.accordionState[index] || false;
    };  

    vm.confirmDeletePhase = function (index, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        if (window.confirm("¿Estás seguro de que deseas eliminar esta fase?")) {
            const phase = getPhaseByIndex(vm.design, index)
            designEditActions.removePhase(vm.design, phase);
            delete vm.accordionState[index];
        }
    };

    vm.saveDesign = async function() {
        try {
            if (vm.design == null) {
                throw Error("Cannot save a null design");
            }
            await DesignCatalogService.updateDesign(vm.designId, vm.design);
        }
        catch (error) {
            // TODO: display error on view.
            console.error(error);
        }
    };

    vm.validateItem = function() {
        let validation = { 
            type: "phase",
            valid: true, 
            context: 
                {
                    phaseNumber: vm.phaseNumber, 
                    itemNumber: vm.questionNumber
                }, 
            messages: [] };
        
        if (vm.isEmptyString(vm.question.q_text)) {
            validation.valid = false;
            validation.messages.push("edit_error_sd_missing_question_text");
        }
        if (vm.isEmptyString(vm.question.ans_format.l_pole)) {
            validation.valid = false;
            validation.messages.push("edit_error_sd_missing_value_left_pole");
        }
        if (vm.isEmptyString(vm.question.ans_format.r_pole)) {
            validation.valid = false;
            validation.messages.push("edit_error_sd_missing_value_right_pole");
        }

        if (vm.validateCallback) {
            vm.validateCallback({ result: validation });
        }

        return validation;
    };    

    vm.handleValidationResult = function (result) {
        console.log(`[handleValidationResult] ${JSON.stringify(result)}`);
    
        const { type, context, messages } = result;
    
        if (type === "phase") {
            const phaseKey = `phase_${context.phaseNumber}`;
    
            // Initialize the phase's error container if it doesn't exist
            if (!vm.validationErrors.phases[phaseKey]) {
                vm.validationErrors.phases[phaseKey] = {
                    items: {},          // For item/question errors
                    groupingConfig: [], // For grouping configuration errors
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
    
            // Handle general phase errors
            if (!context.itemNumber && !context.groupingConfig) {
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
                vm.validationErrors.phases[phaseKey].other.length === 0
            ) {
                delete vm.validationErrors.phases[phaseKey];
            }
        }

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
        
        // Handle global errors
        if (type === "global") {
            if (messages.length > 0) {
                vm.validationErrors.global = messages;
            } else {
                vm.validationErrors.global = [];
            }
        }

        console.log("Validation Errors:", JSON.stringify(vm.validationErrors));
    };
        
    vm.getSortedPhaseErrorKeys = function () {
        return Object.keys(vm.validationErrors.phases).sort((a, b) => {
            const phaseNumberA = parseInt(a.split('_')[1], 10);
            const phaseNumberB = parseInt(b.split('_')[1], 10);
            return phaseNumberA - phaseNumberB;
        });
    };    

    vm.canSave = function() {
        return (
            vm.validationErrors.global.length === 0 &&
            Object.keys(vm.validationErrors.phases).length === 0
        );
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