const CaseCardController = function() {
    this.$onInit = function() {
        if (angular.isUndefined(this.showActions)) {
            this.showActions = true;
        }
    };

    this.isFunction = function(variable) {
        return typeof variable === "function";
    };

    this.formatAuthor = function() {
        if (!this.caseItem) {
            return "";
        }

        return [this.caseItem.authorFirstname, this.caseItem.authorLastname]
            .filter(Boolean)
            .join(" ");
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
        onView: "<?",
        onEdit: "<?",
        onDelete: "<?",
    },
    controller: CaseCardController,
    templateUrl: "/assets/static/views/teacher/fragments/case-card.template.html",
};

export default caseCardComponent;
