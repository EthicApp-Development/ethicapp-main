function ItemDeleterController($translate) {
    const vm = this;

    vm.$onInit = function () {
        // console.debug(`[itemDeleterComponent] index: ${vm.index} phaseNumber: ${vm.phaseNumber}`);
    };

    vm.deleteItem = function () {
        $translate('delete_item_confirmation_message').then(function (confirmationMessage) {
            if (window.confirm(confirmationMessage)) {
                const deletedItem = vm.items.splice(vm.index, 1); 
            
                if (vm.onDelete) {
                    vm.onDelete(
                        { phaseNumber: vm.phaseNumber, deletedItem: deletedItem[0], index: vm.index }
                    );
                }                
            }         
        });
    };
};

ItemDeleterController.$inject = ['$translate'];

const itemDeleterComponent = {
    bindings: {
        phaseNumber: '<',
        items: '<',
        index: '<',
        onDelete: '&?'
    },
    controller: ItemDeleterController,
    template: `
    <div class="item-deleter">
        <button class="btn btn-default btn-sm" ng-click="$ctrl.deleteItem()">
            <i class="fa-solid fa-trash text-danger"></i>
            {{ 'delete_item_button_text' | translate }}
        </button>
    </div>
    `,
};

export default itemDeleterComponent;