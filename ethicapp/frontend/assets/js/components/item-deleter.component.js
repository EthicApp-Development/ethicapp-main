const itemDeleterComponent = {
    bindings: {
        items: '<',
        index: '<',
    },
    controller: ItemDeleterController,
    //ng-click="$ctrl.deleteItem()
    template: `
    <div class="item-deleter">
        <button class="btn btn-default btn-sm" ng-click="$ctrl.deleteItem()">
            <i class="fa-solid fa-trash text-danger"></i>
            {{ 'delete_item_button_text' | translate }}
        </button>
    </div>
    `,
};

function ItemDeleterController($translate) {
    const vm = this;

    vm.deleteItem = function () {
        $translate('delete_item_confirmation_message').then(function (confirmationMessage) {
            if (window.confirm(confirmationMessage)) {
                vm.items.splice(vm.index, 1); // Elimina el elemento en el índice actual
            }
        });
    };
}
ItemDeleterController.$inject = ['$translate'];

export default itemDeleterComponent;