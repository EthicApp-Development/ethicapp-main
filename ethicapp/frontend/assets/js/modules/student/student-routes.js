function StudentRouter($routeProvider) {
    $routeProvider
        .when('/', {
            templateUrl: 'static/partials/student/session.index.html',
        })
        .when('/activities/:id', {
            templateUrl: 'static/partials/student/activity.view.html',
        })                  
        .when('/profile', {
            templateUrl: 'static/partials/student/profile.html',
        })  
        .when('/error/:errorCode/:backSteps', {
            templateUrl: function(params) {
              return 'static/partials/student/error.' + params.errorCode + '.html';
            },
            controller: 'ErrorController'
          })
          .otherwise({
            redirectTo: '/error/404'
          })        
        .when('/error/:errorCode', {
            templateUrl: function(params) {
              return 'static/partials/student/error.' + params.errorCode + '.html';
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

export { StudentRouter };
