function StudentRouter($routeProvider) {
    $routeProvider
        .when('/', {
            templateUrl: 'static/templates/student/session.index.html',
        })
        .when('/activities/:id', {
            templateUrl: 'static/templates/student/activity.view.html',
        })                  
        .when('/profile', {
            templateUrl: 'static/templates/student/profile.html',
        })  
        .when('/error/:errorCode/:backSteps', {
            templateUrl: function(params) {
              return 'static/templates/student/error.' + params.errorCode + '.html';
            },
            controller: 'ErrorController'
          })
          .otherwise({
            redirectTo: '/error/404'
          })        
        .when('/error/:errorCode', {
            templateUrl: function(params) {
              return 'static/templates/student/error.' + params.errorCode + '.html';
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
