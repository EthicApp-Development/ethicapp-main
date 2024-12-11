import rankingItemsEditorTemplate from "./templates/design-editor/ranking-items-editor.template.js";

const rankingItemsEditorComponent = {
    bindings: {
        items: '<',
        validateCallback: '&?'
    },
    template: rankingItemsEditorTemplate,
    controller: RankingItemsEditorController,
};

function RankingItemsEditorController() {
    const vm = this;
    console.log("[RankingItemsController] init");

    vm.$onInit = function() {
        console.log("[RankingItemsController] init");
    };

    vm.addItem = function() {
        vm.items.push({ name: '', wc: 0 });
    };
    
    vm.removeItem = function(item) {
        const index = vm.items.indexOf(item);
        if (index > -1) {
            vm.items.splice(index, 1);
        }
    };    
}

export default rankingItemsEditorComponent;