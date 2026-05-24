function TeacherRouter($routeProvider) {
    $routeProvider
        .when('/', {
            templateUrl: 'static/views/teacher/home.html',
        })
        .when('/designs', {
            templateUrl: 'static/views/teacher/design.index.html',
        })
        .when('/designs/new', {
            templateUrl: 'static/views/teacher/design.new.html',
        })
        .when('/designs/:id', {
            templateUrl: 'static/views/teacher/design.view.html',
        })        
        .when('/designs/:id/edit', {
            templateUrl: 'static/views/teacher/design.edit.html',
        })              
        .when('/activities', {
            templateUrl: 'static/views/teacher/activity.index.html',
        })
        .when('/activities/new', {
            templateUrl: 'static/views/teacher/activity.new.html',
        })        
        .when('/activities/new/:designId', {
            templateUrl: 'static/views/teacher/activity.new.html',
        })
        .when('/activities/:session_id/reports', {
            templateUrl: 'static/views/teacher/activity.reports.html',
        })
        .when('/activities/:id', {
            templateUrl: 'static/views/teacher/activity.view.html',
        })                  
        .when('/profile', {
            templateUrl: 'static/views/teacher/profile.html',
        })  
        .when('/users', {
            templateUrl: 'static/views/teacher/users.html',
        })
        .when('/cases', {
            templateUrl: 'static/views/teacher/cases.index.html',
        })
        .when('/cases/new', {
            templateUrl: 'static/views/teacher/cases.new.html',
        })
        .when('/cases/:id', {
            templateUrl: 'static/views/teacher/cases.view.html',
        })
        .when('/cases/:id/edit', {
            templateUrl: 'static/views/teacher/cases.edit.html',
        })
        .when('/error/:errorCode/:backSteps', {
            templateUrl: function(params) {
              return 'static/views/teacher/error.' + params.errorCode + '.html';
            },
            controller: 'ErrorController'
          })
          .otherwise({
            redirectTo: '/error/404'
          })        
        .when('/error/:errorCode', {
            templateUrl: function(params) {
              return 'static/views/teacher/error.' + params.errorCode + '.html';
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
