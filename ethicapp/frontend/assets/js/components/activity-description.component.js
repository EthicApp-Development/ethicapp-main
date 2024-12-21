import { getNameByCode } from "../../../../common/modules/session-status.js";

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
            return getNameByCode(value);
        };

        this.isFunction = function(variable) {
            return typeof variable === 'function';
        };
    },
};

export { activityDescriptionComponent };
