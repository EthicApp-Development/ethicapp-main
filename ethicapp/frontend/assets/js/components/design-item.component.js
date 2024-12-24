const DesignItemController = function() {
    this.isFunction = function(variable) {
        // console.log("[DesignItemController::isFunction]", variable, typeof variable === 'function');
        return typeof variable === 'function';
    };
}

const designItemComponent = {
    bindings: {
        design: '<',
        isOwner: '<',
        onLaunch: '<?',
        onEdit: '<?',
        onView: '<?',
        onSelect: '<?',
        onDelete: '<?',
        onDuplicate: '<?',
        onTogglePublic: '<?',
        onImport: '<?',
        selectedDesignId: '<'
    },
    controller: DesignItemController,
    templateUrl: "/assets/static/partials/teacher/micro-partials/design-item.template.html"
};

export default designItemComponent;
