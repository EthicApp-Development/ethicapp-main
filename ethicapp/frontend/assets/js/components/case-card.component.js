const CaseCardController = function() {
    this.$onInit = function() {
        if (angular.isUndefined(this.showActions)) {
            this.showActions = true;
        }
        if (angular.isUndefined(this.showExtendedInfo)) {
            this.showExtendedInfo = false;
        }
    };

    this.isFunction = function(variable) {
        return typeof variable === "function";
    };

    this.formatAuthor = function() {
        if (!this.caseItem) {
            return "";
        }

        if (Array.isArray(this.caseItem.authors) && this.caseItem.authors.length > 0) {
            return this.caseItem.authors.map((author) => {
                return [author.authorFirstname, author.authorLastname].filter(Boolean).join(" ");
            }).filter(Boolean).join("; ");
        }

        return [this.caseItem.authorFirstname, this.caseItem.authorLastname]
            .filter(Boolean)
            .join(" ");
    };

    this.getLanguageLabel = function() {
        return this.caseItem?.languageCode || "";
    };

    this.getVisibilityLabelKey = function() {
        return this.caseItem?.visibility === "public" ? "visibility_public" : "visibility_private";
    };

    this.getRightsStatusLabelKey = function() {
        return `rights_status_${this.caseItem?.rightsStatus || "unknown"}`;
    };

    this.canToggleVisibility = function() {
        return this.isFunction(this.onTogglePublic)
            && this.caseItem?.hasLaunchedDesignActivity !== true
            && this.caseItem?.archived !== true;
    };

    this.canImport = function() {
        return this.isFunction(this.onImport)
            && this.caseItem?.visibility === "public"
            && this.caseItem?.archived !== true;
    };

    this.canDelete = function() {
        return this.isFunction(this.onDelete) && this.caseItem?.hasLaunchedDesignActivity !== true;
    };

    this.getContentRepresentation = function() {
        if (!this.caseItem || !Array.isArray(this.caseItem.representations)) {
            return null;
        }

        return this.caseItem.representations.find((representation) => {
            return representation.rel === "content";
        }) || null;
    };

    this.getContentUrl = function() {
        return this.getContentRepresentation()?.href || this.caseItem?.pdfPath || "";
    };

    this.getDocumentProcessing = function() {
        return this.caseItem?.documentProcessing || null;
    };

    this.getDocumentProcessingLabelKey = function() {
        const status = this.getDocumentProcessing()?.status;
        switch (status) {
        case "pending":
            return "ethical_cases_document_processing_pending";
        case "processing":
            return "ethical_cases_document_processing_processing";
        case "completed":
            return "ethical_cases_document_processing_completed";
        case "failed":
            return "ethical_cases_document_processing_failed";
        default:
            return "ethical_cases_document_processing_unknown";
        }
    };

    this.getDocumentProcessingLabelClass = function() {
        const status = this.getDocumentProcessing()?.status;
        switch (status) {
        case "pending":
            return "label label-default";
        case "processing":
            return "label label-info";
        case "completed":
            return "label label-success";
        case "failed":
            return "label label-danger";
        default:
            return "label label-default";
        }
    };
};

const caseCardComponent = {
    bindings: {
        caseItem: "<",
        showActions: "<?",
        showExtendedInfo: "<?",
        onView: "<?",
        onEdit: "<?",
        onDelete: "<?",
        onDuplicate: "<?",
        onArchive: "<?",
        onTogglePublic: "<?",
        onImport: "<?",
    },
    controller: CaseCardController,
    templateUrl: "/assets/static/views/teacher/fragments/case-card.template.html",
};

export default caseCardComponent;
