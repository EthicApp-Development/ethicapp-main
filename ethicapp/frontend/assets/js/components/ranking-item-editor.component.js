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
}

export default rankingItemEditorComponent;