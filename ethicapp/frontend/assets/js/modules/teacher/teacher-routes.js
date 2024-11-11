function TeacherRouter($routeProvider) {
    $routeProvider
        .when('/', {
            templateUrl: 'static/partials/teacher/home.html',
        })
        .when('/designs', {
            templateUrl: 'static/partials/teacher/design.index.html',
        })
        .when('/designs/new', {
            templateUrl: 'static/partials/teacher/design.new.html',
        })
        .when('/designs/:id', {
            templateUrl: 'static/partials/teacher/design.view.html',
        })        
        .when('/designs/:id/edit', {
            templateUrl: 'static/partials/teacher/design.edit.html',
        })              
        .when('/activities', {
            templateUrl: 'static/partials/teacher/activities.html',
        })
        .when('/activities/new', {
            templateUrl: 'static/partials/teacher/activity.new.html',
        })        
        .when('/activities/new/:designId', {
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
        .when('/error/:errorCode/:backSteps', {
            templateUrl: function(params) {
              return 'static/partials/teacher/error.' + params.errorCode + '.html';
            },
            controller: 'ErrorController'
          })
          .otherwise({
            redirectTo: '/error/404'
          })        
        .when('/error/:errorCode', {
            templateUrl: function(params) {
              return 'static/partials/teacher/error.' + params.errorCode + '.html';
            },
            controller: 'ErrorController'
          })
          .otherwise({
            redirectTo: '/error/404'
          })
        .otherwise({
            redirectTo: '/error/404'
        });
};

export { TeacherRouter };
