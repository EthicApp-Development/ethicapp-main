function NumericInputWithSpinbuttonController() {
    const vm = this;

    vm.increaseValue = function () {
        const step = parseInt(vm.step || 1);
        const max = vm.max ? parseInt(vm.max) : Infinity;
        if (!vm.value) vm.value = 0;
        if (vm.value + step <= max) {
            vm.value += step;
        }
    };

    vm.decreaseValue = function () {
        const step = parseInt(vm.step || 1);
        const min = vm.min ? parseInt(vm.min) : 0;
        if (!vm.value) vm.value = 0;
        if (vm.value - step >= min) {
            vm.value -= step;
        }
    };

    vm.isMin = function () {
        return vm.min && vm.value <= parseInt(vm.min);
    };

    vm.isMax = function () {
        return vm.max && vm.value >= parseInt(vm.max);
    };

    vm.onValueChange = function () {
        const min = vm.min ? parseInt(vm.min) : 0;
        const max = vm.max ? parseInt(vm.max) : Infinity;
        if (vm.value < min) {
            vm.value = min;
        }
        if (vm.value > max) {
            vm.value = max;
        }
    };
};

const numericInputWithSpinbuttonComponent = {
    bindings: {
        value: '=',        // Double-data binding with variable
        min: '@?',         // Minimum (optional)
        max: '@?',         // Maximum (optional)
        step: '@?',        // Step (optional)
        id: '@?',          // Field id (optional)
    },
    template: `
        <div class="input-group group-size-input">
            <span class="input-group-btn">
                <button class="btn btn-default" type="button" ng-click="$ctrl.decreaseValue()" ng-disabled="$ctrl.isMin()">
                    -
                </button>
            </span>
            <input type="number" class="form-control text-center" 
                   ng-model="$ctrl.value"
                   ng-change="$ctrl.onValueChange()"
                   min="{{$ctrl.min || 0}}"
                   max="{{$ctrl.max || Infinity}}"
                   step="{{$ctrl.step || 1}}"
                   id="{{$ctrl.id}}">
            <span class="input-group-btn">
                <button class="btn btn-default" type="button" ng-click="$ctrl.increaseValue()" ng-disabled="$ctrl.isMax()">
                    +
                </button>
            </span>
        </div>
    `,
    controller: NumericInputWithSpinbuttonController
};

export default numericInputWithSpinbuttonComponent;
