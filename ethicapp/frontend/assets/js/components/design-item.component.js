const DesignItemController = function() {
    const normalizeKnownText = function(value) {
        if (value === undefined || value === null) {
            return "";
        }
        const normalizedValue = String(value).trim();
        const tokens = normalizedValue.split(/[,\s]+/).filter(Boolean);
        if (normalizedValue === "" || tokens.every(token => token.toLowerCase() === "unknown")) {
            return "";
        }
        return normalizedValue;
    };

    this.isFunction = function(variable) {
        // console.log("[DesignItemController::isFunction]", variable, typeof variable === 'function');
        return typeof variable === 'function';
    };

    this.getAuthorLabel = function() {
        const metainfo = this.design?.metainfo || {};
        const authorName = normalizeKnownText(metainfo.authorName);
        const institution = normalizeKnownText(metainfo.institution);
        return [authorName, institution].filter(Boolean).join(", ");
    };

    this.hasAuthorEmail = function() {
        return Boolean(normalizeKnownText(this.design?.metainfo?.email));
    };

    this.getAssociatedCase = function() {
        return this.associatedCase || this.design?.associatedCase || null;
    };

    this.getVisibilityLabelKey = function() {
        return this.design?.visibility === "public" ? "visibility_public" : "visibility_private";
    };

    this.hasOriginalDesign = function() {
        return Boolean(this.design?.originalDesignId || this.design?.sourceDesignTitle || this.design?.sourceDesignAuthor);
    };

    this.canImportDesign = function() {
        if (!this.isFunction(this.onImport) || this.isOwner) {
            return false;
        }

        const associatedCase = this.getAssociatedCase();
        return !associatedCase || (associatedCase.visibility === "public" && associatedCase.archived !== true);
    };

    this.isImportBlockedByCase = function() {
        return !this.isOwner && this.isFunction(this.onImport) && !this.canImportDesign();
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
        onArchive: '<?',
        onTogglePublic: '<?',
        onImport: '<?',
        selectionLayout: '<?',
        selectedDesignId: '<'
    },
    controller: DesignItemController,
    templateUrl: "/assets/static/views/teacher/fragments/design-item.template.html"
};

export default designItemComponent;
