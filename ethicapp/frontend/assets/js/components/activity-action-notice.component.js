// The notice after an activity's row action (#1094, epic #1093), on the
// Activities page and the teacher's home. `actions` is an instance of
// ActivityRowActionsService (`create(scope, options)`), which owns the
// notice, its message, its links and its timer; the component only shows it.

const activityActionNoticeComponent = {
    bindings: {
        actions: "<",
    },
    templateUrl: "/assets/static/views/teacher/fragments/activity-action-notice.template.html",
};

export default activityActionNoticeComponent;
