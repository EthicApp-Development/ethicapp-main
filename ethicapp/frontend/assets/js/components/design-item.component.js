const DesignItemController = function() {
    this.isFunction = function(variable) {
        // console.log("[DesignItemController::isFunction]", variable, typeof variable === 'function');
        return typeof variable === 'function';
    };

    this.getAssociatedCase = function() {
        return this.associatedCase || this.design?.associatedCase || null;
    };

    this.formatCaseLabel = function(caseItem) {
        if (!caseItem) {
            return "";
        }
        const hasAuthor = caseItem.authorFirstname || caseItem.authorLastname;
        if (hasAuthor) {
            return `${caseItem.title} (${caseItem.authorFirstname || ""} ${caseItem.authorLastname || ""})`.trim();
        }
        return caseItem.title;
    };
}

const designItemComponent = {
    bindings: {
        design: '<',
        associatedCase: '<?',
        isOwner: '<',
        onLaunch: '<?',
        onEdit: '<?',
        onView: '<?',
        onSelect: '<?',
        onDelete: '<?',
        onDuplicate: '<?',
        onTogglePublic: '<?',
        onImport: '<?',
        selectionLayout: '<?',
        selectedDesignId: '<'
    },
    controller: DesignItemController,
    templateUrl: "/assets/static/views/teacher/fragments/design-item.template.html"
};

export default designItemComponent;
