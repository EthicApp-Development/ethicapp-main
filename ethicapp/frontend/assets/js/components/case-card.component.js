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
