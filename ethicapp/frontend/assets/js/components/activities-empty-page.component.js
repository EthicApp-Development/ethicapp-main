// The page of a teacher with no activities yet (#1053, frame E), as a
// component (#1098, epic #1093) shown by the Activities page in place of "En
// curso" and by the teacher's home in place of its two sections. The host
// decides `show-design-step` with `designStepNeeded`
// (`helpers/activities-empty-page.js`) before it shows the component, so step
// 1 does not flicker.

const activitiesEmptyPageComponent = {
    bindings: {
        showDesignStep: "<",
    },
    templateUrl: "/assets/static/views/teacher/fragments/activities-empty-page.template.html",
};

export default activitiesEmptyPageComponent;
