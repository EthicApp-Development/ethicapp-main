const toastComponent = {
    bindings: {
        id: '<',
        message: '<',  
        type: '<',     
        duration: '<?'
    },
    template: `
        {{$ctrl.id}}, {{$ctrl.message}}, {{$ctrl.type}}, {{$ctrl.duration}}
        <div ng-if="$ctrl.message" class="toast-container">
            <div class="toast alert alert-{{$ctrl.type}}" role="alert">
                {{ $ctrl.message }}
            </div>
        </div>
    `,
    controller: ToastController
};

function ToastController($timeout) {
    const vm = this;

    vm.$onInit = function () {
        if (vm.message && vm.duration) {
            $timeout(() => {
                vm.message = null;
            }, vm.duration);
        }
    };

    vm.$onChanges = function (changes) {
        vm.$onChanges = function (changes) {
            if (changes.id && changes.id.currentValue) {
                console.log('[vm.$onChanges] ID changed:', changes.id.currentValue);
        
                // Reset the message using the new binding value
                if (changes.message && changes.message.currentValue) {
                    vm.message = changes.message.currentValue;
                }
                
                // React to ID change (which implies a new message)
                if (vm.message && vm.duration) {
                    $timeout(() => {
                        vm.message = null;
                    }, vm.duration);
                }
            }
        };
        
    };
};

toastComponent.$inject = ['$timeout'];

export default toastComponent;
