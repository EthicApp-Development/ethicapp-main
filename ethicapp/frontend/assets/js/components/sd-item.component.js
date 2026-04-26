function SDItemController() {
    const vm = this;
    const MIN_JUSTIFICATION_WORDS = 5;

    vm.buildOptions = function(values) {
        return Array.from({ length: values }, (_, i) => i + 1);
    };

    vm.addScaleTick = function() {
        if (vm.question && vm.question.ans_format) {
            const currVal = vm.question.ans_format.values;
            vm.question.ans_format.values = Math.min(10, currVal + 1);
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
        if (vm.question.ans_format.just_required
            && vm.question.ans_format.justification_minimum_length_required
            && vm.question.ans_format.min_just_length < MIN_JUSTIFICATION_WORDS) {
            validation.valid = false;
            validation.messages.push("edit_error_sd_min_justification_length");
        }

        if (vm.validateCallback) {
            vm.validateCallback({ result: validation });
        }

        return validation;
    };

    vm.removeScaleTick = function() {
        if (vm.question && vm.question.ans_format && vm.question.ans_format.values > 1) {
            const currVal = vm.question.ans_format.values;
            vm.question.ans_format.values = Math.max(2, currVal - 1);
        }
    };

    vm.onJustificationRequiredChange = function() {
        if (!vm.question?.ans_format) {
            return;
        }

        if (!vm.question.ans_format.just_required) {
            vm.question.ans_format.justification_minimum_length_required = false;
            vm.question.ans_format.min_just_length = 0;
        } else if (!Number.isInteger(vm.question.ans_format.min_just_length)
            || vm.question.ans_format.min_just_length < MIN_JUSTIFICATION_WORDS) {
            vm.question.ans_format.min_just_length = MIN_JUSTIFICATION_WORDS;
        }

        vm.validateItem();
    };

    vm.onMinimumLengthRequiredChange = function() {
        if (!vm.question?.ans_format) {
            return;
        }

        if (vm.question.ans_format.justification_minimum_length_required
            && (!Number.isInteger(vm.question.ans_format.min_just_length)
                || vm.question.ans_format.min_just_length < MIN_JUSTIFICATION_WORDS)) {
            vm.question.ans_format.min_just_length = MIN_JUSTIFICATION_WORDS;
        }

        vm.validateItem();
    };

    vm.$onInit = function () {
        vm.showSeparator = vm.showSeparator !== false;
        vm.showSeparator = false;
        vm.normalizeJustificationSettings();

        if (vm.validateCallback) {
            const validation = vm.validateItem();
            vm.validateCallback({ result: validation });
        }        
    };

    vm.$onDestroy = function() {
        vm.selectedMode = null;
        if (vm.validateCallback) {
            const validation = vm.validateItem();
            vm.validateCallback({ result: validation });
        }
    }

    vm.isEmptyString = function(value) {
        return typeof value === 'string' && value.trim() === '';
    };

    vm.normalizeJustificationSettings = function() {
        if (!vm.question || !vm.question.ans_format) {
            return;
        }

        if (typeof vm.question.ans_format.just_required !== "boolean") {
            vm.question.ans_format.just_required = false;
        }

        if (typeof vm.question.ans_format.justification_minimum_length_required !== "boolean") {
            vm.question.ans_format.justification_minimum_length_required = false;
        }

        if (!vm.question.ans_format.just_required) {
            vm.question.ans_format.justification_minimum_length_required = false;
            vm.question.ans_format.min_just_length = 0;
            return;
        }

        if (!Number.isInteger(vm.question.ans_format.min_just_length)) {
            vm.question.ans_format.min_just_length = MIN_JUSTIFICATION_WORDS;
        }
    };
};

const sdItemComponent = {
    bindings: {
        phaseNumber: '<?',
        question: '=',
        questionNumber: '=',
        text: '=',
        validateCallback: '&?',
        showSeparator: '<?',
    },
    transclude: true,
    templateUrl: "/assets/static/views/student/fragments/sd-item.template.html",   
    controller: SDItemController,
};

export default sdItemEditorComponent;
