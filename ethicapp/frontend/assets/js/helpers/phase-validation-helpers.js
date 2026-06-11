const MIN_JUSTIFICATION_WORDS = 5;

function hasText(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function ensurePhaseErrors(validationErrors, phaseNumber) {
    const phaseKey = `phase_${phaseNumber}`;

    if (!validationErrors.phases[phaseKey]) {
        validationErrors.phases[phaseKey] = {
            items:             {},
            groupingConfig:    [],
            phaseInstructions: [],
            other:             [],
        };
    }

    return validationErrors.phases[phaseKey];
}

function cleanupPhaseErrors(validationErrors, phaseNumber) {
    const phaseKey = `phase_${phaseNumber}`;
    const phaseErrors = validationErrors.phases[phaseKey];

    if (phaseErrors && isPhaseValid(phaseErrors)) {
        delete validationErrors.phases[phaseKey];
    }
}

function validateDesignPhases(design, validationErrors) {
    if (!Array.isArray(design?.phases) || design.phases.length === 0) {
        validationErrors.global = ["error_no_phases_defined"];
    }
}

function validatePhaseItems(designType, phase, phaseNumber, validationErrors) {
    const phaseErrors = ensurePhaseErrors(validationErrors, phaseNumber);

    if (designType === "semantic_differential") {
        const questions = Array.isArray(phase?.questions) ? phase.questions : [];

        if (questions.length === 0) {
            phaseErrors.other = ["error_no_items_defined"];
            return;
        }

        questions.forEach((question, index) => {
            const messages = [];
            const answerFormat = question?.ans_format ?? {};

            if (!hasText(question?.q_text)) {
                messages.push("edit_error_sd_missing_question_text");
            }

            if (!hasText(answerFormat.l_pole)) {
                messages.push("edit_error_sd_missing_value_left_pole");
            }

            if (!hasText(answerFormat.r_pole)) {
                messages.push("edit_error_sd_missing_value_right_pole");
            }

            if (
                answerFormat.just_required === true
                && answerFormat.justification_minimum_length_required === true
                && (!Number.isInteger(answerFormat.min_just_length)
                    || answerFormat.min_just_length < MIN_JUSTIFICATION_WORDS)
            ) {
                messages.push("edit_error_sd_min_justification_length");
            }

            if (messages.length > 0) {
                phaseErrors.items[`item_${index + 1}`] = messages;
            }
        });
        return;
    }

    if (designType === "ranking") {
        const roles = Array.isArray(phase?.roles) ? phase.roles : [];

        if (roles.length === 0) {
            phaseErrors.other = ["error_no_items_defined"];
            return;
        }

        roles.forEach((item, index) => {
            const messages = [];

            if (!hasText(item?.name)) {
                messages.push("edit_error_ranking_missing_item_text");
            }

            if (
                item?.justification_required === true
                && (item.type === null || item.type === undefined)
            ) {
                messages.push("edit_error_justification_type_undefined");
            }

            if (messages.length > 0) {
                phaseErrors.items[`item_${index + 1}`] = messages;
            }
        });
    }
}

function validatePhaseInstructions(phase, phaseNumber, validationErrors) {
    const hasInstructionsField = Object.prototype.hasOwnProperty.call(phase, "instructions");
    if (!hasInstructionsField || hasText(phase.instructions)) {
        return;
    }

    const phaseErrors = ensurePhaseErrors(validationErrors, phaseNumber);
    phaseErrors.phaseInstructions = ["error_phase_instructions_required"];
}

function validateGroupingConfig(design, phase, phaseIndex, validationErrors) {
    if (phase?.mode !== "team") {
        return;
    }

    const messages = [];
    const groupingAlgorithm = phase.grouping_algorithm;

    if (!hasText(groupingAlgorithm)) {
        messages.push("error_must_select_grouping_algorithm");
    }

    if (groupingAlgorithm === "preserve" && phaseIndex === 0) {
        messages.push("error_cannot_preserve_groups_phase1");
    }

    if (groupingAlgorithm === "preserve") {
        const hasValidPreviousGrouping = design.phases
            .slice(0, phaseIndex)
            .some((previousPhase) => (
                previousPhase.mode === "team"
                && hasText(previousPhase.grouping_algorithm)
            ));

        if (!hasValidPreviousGrouping) {
            messages.push("error_no_previous_grouping");
        }
    }

    if (messages.length > 0) {
        const phaseErrors = ensurePhaseErrors(validationErrors, phaseIndex + 1);
        phaseErrors.groupingConfig = messages;
    }
}

export const isPhaseValid = function(phaseErrors) {
    const itemsValid = !phaseErrors.items || Object.keys(phaseErrors.items).length === 0;
    const groupConfigValid = !phaseErrors.groupingConfig || phaseErrors.groupingConfig.length === 0;
    const instructionsConfigValid = !phaseErrors.phaseInstructions
        || phaseErrors.phaseInstructions.length === 0;
    const otherConfigValid = !phaseErrors.other || phaseErrors.other.length === 0;

    return itemsValid && groupConfigValid && instructionsConfigValid && otherConfigValid;
};

export const isValidationErrorStateValid = function(validationErrors) {
    return (!validationErrors.global || validationErrors.global.length === 0)
        && (!validationErrors.phases || Object.keys(validationErrors.phases).length === 0);
};

export const validateDesign = function(design) {
    const validationErrors = {
        global: [],
        phases: {},
    };
    const designType = design?.type;

    validateDesignPhases(design, validationErrors);

    if (Array.isArray(design?.phases)) {
        design.phases.forEach((phase, index) => {
            const phaseNumber = index + 1;

            validatePhaseItems(designType, phase, phaseNumber, validationErrors);
            validatePhaseInstructions(phase, phaseNumber, validationErrors);
            validateGroupingConfig(design, phase, index, validationErrors);
            cleanupPhaseErrors(validationErrors, phaseNumber);
        });
    }

    return {
        valid: isValidationErrorStateValid(validationErrors),
        validationErrors,
    };
};
