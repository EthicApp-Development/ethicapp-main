import * as StatusCode from "../../../../common/modules/session-status.js";

const activityDescriptionComponent = {
    bindings: {
        activity: '<',
        enableLink: '<',
        onSelect: '<?',
        onArchive: '<?',
        onUnarchive: '<?',
        onView: '<?',
    },
    templateUrl: "/assets/static/partials/teacher/micro-partials/activity-description.template.html",
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
        
        this.isFunction = function(variable) {
            return typeof variable === 'function';
        };
    },
};

export { activityDescriptionComponent };
