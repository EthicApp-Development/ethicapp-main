function SDItemEditController() {
    const vm = this;

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

    vm.$onInit = function () {
        vm.showSeparator = vm.showSeparator !== false;
        vm.showSeparator = false;

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
    }
};

const sdItemEditorComponent = {
    bindings: {
        phaseNumber: '<?',
        question: '=',
        questionNumber: '=',
        validateCallback: '&?',
        showSeparator: '<?',
    },
    transclude: true,
    templateUrl: "/assets/static/partials/teacher/micro-partials/sd-item-editor.template.html",   
    controller: SDItemEditController,
};

export default sdItemEditorComponent;
