function TeacherRouter($routeProvider) {
    $routeProvider
        .when('/', {
            templateUrl: 'static/views/teacher/home.html',
        })
        // The Designs page keeps its state when its tab changes in the URL
        // (`?tab=archived`, #975): a search change is a route update.
        .when('/designs', {
            templateUrl:    'static/views/teacher/design.index.html',
            reloadOnSearch: false,
        })
        // The form reads the case to preselect (`?caseId=`, #1019) and then
        // removes it from the URL, which must not reload the form.
        .when('/designs/new', {
            templateUrl:    'static/views/teacher/design.new.html',
            reloadOnSearch: false,
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
        // The launch wizard keeps its state when its step changes in the
        // URL (`?step=2`, #971): a search change is a route update, not a
        // reload.
        .when('/activities/new', {
            templateUrl:    'static/views/teacher/activity.new.html',
            reloadOnSearch: false,
        })
        .when('/activities/new/:designId', {
            templateUrl:    'static/views/teacher/activity.new.html',
            reloadOnSearch: false,
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
        // The Cases page keeps its state when its tab or filters change in
        // the URL (`?tab=archived`, #1013; `?status=`, `?q=`, #1015): a
        // search change is a route update.
        .when('/cases', {
            templateUrl:    'static/views/teacher/cases.index.html',
            reloadOnSearch: false,
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
