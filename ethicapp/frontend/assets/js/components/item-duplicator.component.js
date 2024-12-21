function ItemDuplicatorController() {
    const vm = this;

    vm.duplicateItem = function () {
        console.log("[ItemDuplicatorController::duplicateItem]");
        if (!Array.isArray(vm.items)) {
            console.error('items is not a valid array:', vm.items);
            return;
        }

        const itemToDuplicate = vm.items[vm.index];
        if (itemToDuplicate === undefined) {
            console.error('No item found at index:', vm.index);
            return;
        }

        const duplicatedItem = JSON.parse(JSON.stringify(itemToDuplicate)); // Deep clone
        vm.items.splice(vm.index + 1, 0, duplicatedItem); // Insert duplicate after the current index
        console.log('Item duplicated:', duplicatedItem);
    };
};

const itemDuplicatorComponent = {
    bindings: {
        items: '<',
        index: '<',
    },
    controller: ItemDuplicatorController,
    transclude: true,
    template: `
        <div class="item-duplicator">
            <button class="btn btn-default btn-sm" ng-click="$ctrl.duplicateItem()">
                <i class="fa-regular fa-copy text-primary"></i>
                {{ 'duplicate_item_button_text' | translate }}
            </button>
            <ng-transclude></ng-transclude>
        </div>
    `,
};

export default itemDuplicatorComponent;
