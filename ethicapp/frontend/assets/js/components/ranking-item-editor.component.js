const rankingItemEditorComponent = {
    bindings: {
        phaseNumber: '<?',
        item: '=',
        itemNumber: '=',
        validateCallback: '&?'
    },
    transclude: true,
    templateUrl: "/assets/static/partials/teacher/micro-partials/ranking-item-editor.template.html",
    controller: RankingItemEditorController,
};

function RankingItemEditorController() {
    const vm = this;

    vm.validate = function() {
        if (vm.validateCallback) {
            const validation = vm.validateFields();
            vm.validateCallback({ result: validation });
        }
    };

    vm.validateFields = function() {
        let validation = { 
            type: "phase",
            valid: true, 
            context: 
                {
                    phaseNumber: vm.phaseNumber, 
                    itemNumber: vm.itemNumber
                }, 
            messages: []
        };
        
        if (vm.isEmptyString(vm.item.name)) {
            validation.valid = false;
            validation.messages.push("edit_error_ranking_missing_item_text");
        }

        if (vm.item.justification_required && 
            (vm.item.type === null || vm.item.type === undefined)) {
            validation.valid = false;
            validation.messages.push("edit_error_justification_type_undefined");
        }

        console.log(`[rankingItemEditor::validateItem] ${JSON.stringify(validation)}`);
        return validation;
    };

    vm.$onInit = function () {
        vm.validate();
    };

    vm.isEmptyString = function(value) {
        return typeof value === 'string' && value.trim() === '';
    };
}

export default rankingItemEditorComponent;