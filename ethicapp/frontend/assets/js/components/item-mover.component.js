const itemMoverComponent = {
    bindings: {
        items: '=',
        item: '<',
        onMove: '&?',
    },
    controller: ItemMoverController,
    template: `
        <div class="phase-mover" style="margin-top:.25em; margin-left: 1em">
            <i ng-if="!$ctrl.isFirstItem()" 
               class="fa-solid fa-caret-up" 
               style="cursor: pointer; font-size:1.25em;" 
               ng-click="$ctrl.moveUp();">
            </i>
            <i ng-if="!$ctrl.isLastItem()" 
               class="fa-solid fa-caret-down" 
               style="cursor: pointer; font-size:1.25em;" 
               ng-click="$ctrl.moveDown()">
            </i>
        </div>`,
};

function ItemMoverController() {
    const vm = this;

    // Cálculo dinámico del índice actual del item
    vm.getIndex = function () {
        return vm.items.indexOf(vm.item);
    };

    vm.isFirstItem = function () {
        return vm.getIndex() === 0;
    };

    vm.isLastItem = function () {
        return vm.getIndex() === vm.items.length - 1;
    };

    vm.moveUp = function () {
        const index = vm.getIndex();
        if (index > 0) {
            swapItems(vm.items, index, index - 1);

            if (vm.onMove) {
                vm.onMove({ fromIndex: index, toIndex: index - 1 });
            }
        }
    };

    vm.moveDown = function () {
        const index = vm.getIndex();
        if (index < vm.items.length - 1) {
            swapItems(vm.items, index, index + 1);

            if (vm.onMove) {
                vm.onMove({ fromIndex: index, toIndex: index + 1 });
            }
        }
    };

    function swapItems(items, fromIndex, toIndex) {
        const temp = items[fromIndex];
        items[fromIndex] = items[toIndex];
        items[toIndex] = temp;
    }
};

export default itemMoverComponent;
