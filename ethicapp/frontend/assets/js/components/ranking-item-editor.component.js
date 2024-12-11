import rankingItemEditorTemplate from "./templates/design-editor/ranking-item-editor.template.js";

const rankingItemEditorComponent = {
    bindings: {
        item: '<',
        validateCallback: '&?'
    },
    transclude: true,
    template: rankingItemEditorTemplate,
    controller: RankingItemEditorController,
};

function RankingItemEditorController() {
    const vm = this; 
}

export default rankingItemEditorComponent;