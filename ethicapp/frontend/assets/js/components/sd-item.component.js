import semanticDifferentialItemTemplate from "./templates/design-editor/sd-item.template.js";

const semanticDifferentialItemComponent = {
    bindings: {
        question: '=',
    },
    template: semanticDifferentialItemTemplate,
    controller: SemanticDifferentialController,
};

function SemanticDifferentialController() {
    const vm = this;

    vm.buildOptions = function(values) {
        return Array.from({ length: values }, (_, i) => i + 1).join(' | ');
    };
}

export default semanticDifferentialItemComponent;
