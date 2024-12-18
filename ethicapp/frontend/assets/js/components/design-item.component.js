let designItemComponent = {
    bindings: {
        design: '<',
        isOwner: '<',
        onLaunch: '&',
        onEdit: '&',
        onView: '&',
        onDelete: '&',
        onDuplicate: '&',
        onTogglePublic: '&',
        onImport: '&'
    },
    controller: DesignItemController,
    templateUrl: "/assets/static/partials/teacher/micro-partials/design-item.template.html"
};

let DesignItemController = function() {

}

export default designItemComponent;
