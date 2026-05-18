import * as StatusCode from "../../../../common/modules/session-status.js";

const activityDescriptionComponent = {
    bindings: {
        activity: '<',
        associatedCase: '<?',
        enableLink: '<',
        onSelect: '<?',
        onArchive: '<?',
        onUnarchive: '<?',
        onView: '<?',
    },
    templateUrl: "/assets/static/views/teacher/fragments/activity-description.template.html",
    controller: function() {
        this.$onInit = function() {
            if (angular.isUndefined(this.enableLink)) {
                this.enableLink = true;
            }
        };

        this.getReadableStatus = function(value) {
            // Convert name to code if needed
            const code = isNaN(value) ? StatusCode.getStatusCode(value) : value;
            return StatusCode.getNameByCode(code);
        };

        this.getAssociatedCase = function() {
            return this.associatedCase || this.activity?.design?.associatedCase || null;
        };

        this.formatCaseLabel = function(caseItem) {
            if (!caseItem) {
                return "";
            }

            const author = [caseItem.authorFirstname, caseItem.authorLastname].filter(Boolean).join(" ");
            return author ? `${caseItem.title} (${author})` : caseItem.title;
        };
        
        this.isFunction = function(variable) {
            return typeof variable === 'function';
        };
    },
};

export { activityDescriptionComponent };
