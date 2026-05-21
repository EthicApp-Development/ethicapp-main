function findContainerClass($element) {
    const parent = $element.parent();
    const parentNode = parent && parent[0];
    const classList = parentNode ? Array.from(parentNode.classList) : [];
    const containerClass = classList.find((className) => className.endsWith("-toast-container"));

    return containerClass || "teacher-toast-container";
}

const teacherToastComponent = {
    bindings: {
        containerClass: "@?"
    },
    controller: ["$scope", "$element", "toast", function($scope, $element, toast) {
        const $ctrl = this;

        $ctrl.$postLink = function() {
            $ctrl.resolvedContainerClass = $ctrl.containerClass || findContainerClass($element);
            $ctrl.currentToast = toast.getToast($ctrl.resolvedContainerClass);
        };

        $scope.$on("teacherToastChanged", function(_event, containerClass) {
            if (containerClass !== $ctrl.resolvedContainerClass) {
                return;
            }

            $ctrl.currentToast = toast.getToast($ctrl.resolvedContainerClass);
        });

        $ctrl.dismiss = function() {
            if ($ctrl.currentToast) {
                toast.dismiss($ctrl.resolvedContainerClass, $ctrl.currentToast.id);
            }
        };

        $ctrl.alertClass = function() {
            const type = $ctrl.currentToast ? $ctrl.currentToast.type : "info";
            return `alert-${type}`;
        };
    }],
    template: `
        <div class="teacher-toast" ng-if="$ctrl.currentToast">
            <div class="alert teacher-toast-alert" ng-class="$ctrl.alertClass()" role="status" aria-live="polite">
                <button
                    type="button"
                    class="close"
                    aria-label="Close"
                    ng-if="$ctrl.currentToast.dismissible"
                    ng-click="$ctrl.dismiss()">
                    <span aria-hidden="true">&times;</span>
                </button>
                <span ng-bind="$ctrl.currentToast.message"></span>
            </div>
        </div>
    `
};

export default teacherToastComponent;
