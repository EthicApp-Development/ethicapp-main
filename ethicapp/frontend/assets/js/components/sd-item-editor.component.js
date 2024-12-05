import semanticDifferentialItemTemplate from "./templates/design-editor/sd-item.template.js";

const sdItemEditorComponent = {
    bindings: {
        question: '=',
    },
    template: semanticDifferentialItemTemplate,
    controller: SDItemEditController,
};

function SDItemEditController() {
    const vm = this;

    vm.buildOptions = function(values) {
        return Array.from({ length: values }, (_, i) => i + 1);
    };

    vm.addScaleTick = function() {
        console.log("[addScaleTick]");
        if (vm.question && vm.question.ans_format) {
            const currVal = vm.question.ans_format.values;
            vm.question.ans_format.values = Math.min(10, currVal + 1);
        }
    };

    vm.removeScaleTick = function() {
        if (vm.question && vm.question.ans_format && vm.question.ans_format.values > 1) {
            const currVal = vm.question.ans_format.values;
            vm.question.ans_format.values = Math.max(2, currVal - 1);
        }
    };
}

export default sdItemEditorComponent;
