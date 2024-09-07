/*eslint func-style: ["error", "expression"]*/
export let RoutingController = function($scope) {
    console.log("Routing Controller Initialized");
    $scope.template = {      
        "home":           "views/partials/teacher/home.html",
        "newDesign":      "views/partials/teacher/new-design.html",
        "newDesignExt":   "views/partials/teacher/new-design-ext.html",
        "designs":        "views/partials/teacher/designs.html",
        "users":          "views/partials/teacher/users.html",
        "activities":     "views/partials/teacher/activities.html",
        "launchActivity": "views/partials/teacher/launch-activity.html",
        "viewDesign":     "views/partials/teacher/view-design.html",
        "activity":       "views/partials/teacher/activity.html",
        "profile":        "views/partials/profile.html",
        "cases":          "views/partials/teacher/cases.html",
        "caseEditor":     "views/partials/teacher/case-editor.html",
    };
};
