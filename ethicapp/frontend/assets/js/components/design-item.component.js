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

    this.getTags = function() {
        return Array.isArray(this.design?.tags) ? this.design.tags : [];
    };

    this.hasTags = function() {
        return this.getTags().length > 0;
    };

    this.hasOriginalDesign = function() {
        return Boolean(this.design?.originalDesignId || this.design?.sourceDesignTitle || this.design?.sourceDesignAuthor);
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

// The design's summary card, shown by the design view (with its launch, edit
// and sharing actions) and by the activity dashboard's Design tab (read-only).
// The Designs page and the launch wizard have their own rows (epics #965 and
// #966).
const designItemComponent = {
    bindings: {
        design: '<',
        associatedCase: '<?',
        isOwner: '<',
        onLaunch: '<?',
        onEdit: '<?',
        onTogglePublic: '<?'
    },
    controller: DesignItemController,
    templateUrl: "/assets/static/views/teacher/fragments/design-item.template.html"
};

export default designItemComponent;
