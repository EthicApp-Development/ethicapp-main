function TeacherRouter($routeProvider) {
    $routeProvider
        .when('/', {
            templateUrl: 'static/partials/teacher/home.html',
        })
        .when('/designs', {
            templateUrl: 'static/partials/teacher/designs.html',
        })
        .when('/designs/new', {
            templateUrl: 'static/partials/teacher/design.new.html',
        })
        .when('/designs/:id/edit', {
            templateUrl: 'static/partials/teacher/design.edit.html',
        })              
        .when('/designs/:id', {
            templateUrl: 'static/partials/teacher/design.view.html',
        })
        .when('/activities', {
            templateUrl: 'static/partials/teacher/activities.html',
        })
        .when('/activities/new', {
            templateUrl: 'static/partials/teacher/activity.new.html',
        })        
        .when('/activities/new/:design_id', {
            templateUrl: 'static/partials/teacher/activity.new.html',
        })  
        .when('/activities/:id', {
            templateUrl: 'static/partials/teacher/activity.html',
        })
        .when('/profile', {
            templateUrl: 'static/partials/teacher/profile.html',
        })  
        .when('/users', {
            templateUrl: 'static/partials/teacher/users.html',
        })
        .otherwise({
            redirectTo: '/'
        });
};

export { TeacherRouter };
