import rankingItemTemplate from "./templates/design-editor/ranking-item.template.js";

const rankingItemComponent = {
    bindings: {
        phase: '=',
    },
    template: rankingItemTemplate,
    controller: RankingController,
};

function RankingController() {
    const vm = this;

    vm.addRole = function() {
        vm.phase.roles.push({ name: '', wc: 0 });
    };

    vm.removeRole = function(index) {
        vm.phase.roles.splice(index, 1);
    };
}

export default rankingItemComponent;