import * as StatusCode from "../../../../common/modules/session-status.js";
import { activityTitleParts } from "../helpers/activity-title.js";

const activityDescriptionComponent = {
    // `showStatusAndCode` is false where the dashboard's activity bar shows
    // them instead (#893).
    bindings: {
        activity:          "<",
        associatedCase:    "<?",
        enableLink:        "<",
        onSelect:          "<?",
        onArchive:         "<?",
        onUnarchive:       "<?",
        onView:            "<?",
        showStatusAndCode: "<?",
    },
    templateUrl: "/assets/static/views/teacher/fragments/activity-description.template.html",
    controller: function() {
        this.$onInit = function() {
            if (angular.isUndefined(this.enableLink)) {
                this.enableLink = true;
            }
            if (angular.isUndefined(this.showStatusAndCode)) {
                this.showStatusAndCode = true;
            }
        };

        // The heading's `name` and `description` (#973), "" when missing.
        this.title = activityTitleParts(this.activity);

        this.$doCheck = function() {
            const title = activityTitleParts(this.activity);
            // Keep the same object while nothing changed, so watchers settle.
            if (title.name !== this.title.name || title.description !== this.title.description) {
                this.title = title;
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
