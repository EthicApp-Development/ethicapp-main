"use strict";

import { ActivitiesService } from "../../services/teacher/activities_service.js";
import { DesignsService } from "../../services/teacher/designs_service.js";
import { SessionsService } from "../../services/teacher/sessions_service.js";
import { DocumentsService } from "../../services/teacher/documents_service.js";

var adpp = angular.module("Admin", ["ngSanitize", "btford.socket-io", 
    "api-params", "ui.bootstrap", "ui.multiselect", "nvd3", "timer",
    "ui-notification", "ngQuill", "tableSort", "pascalprecht.translate", 
    "ngRoute", "checklist-model", "ngDialog"]
).factory("TabStateService", function() {
    // Maintains the state of the main tab view of the UI
    var service = {};
    service.sharedTabState = { type: 0 };
    return service;
}).factory("ActivitiesService", ["$rootScope", "$http", ActivitiesService])
    .factory("DesignsService", ["$rootScope", "$http", DesignsService])
    .factory("SessionsService", ["$rootScope", "$http", SessionsService])
    .factory("DocumentsService", ["$rootScope", "$http", DocumentsService]);

import { ActivityController } from "../../controllers/teacher/activity_controller.js";
import { StagesController } from "../../controllers/teacher/stages_controller.js";
import { BrowseDesignsController } from "../../controllers/teacher/browse_designs_controller.js";
import { ConfirmModalController } from "../../controllers/teacher/confirm_modal_controller.js";
import { ContentModalController } from "../../controllers/teacher/content_modal_controller.js";
import { DashboardController } from "../../controllers/teacher/dashboard_controller.js";
import { DesignsDocController } from "../../controllers/teacher/designs_doc_controller.js";
import { GroupController } from "../../controllers/teacher/group_controller.js";
import { IncomingUsersController } from "../../controllers/teacher/incoming_users_controller.js";
import { HomeController } from "../../controllers/teacher/home_controller.js";
import { TabsController } from "../../controllers/tabs_controller.js";
import { MonitorActivityController } from "../../controllers/teacher/monitor_activity_controller.js";
import { RoutingController } from "../../controllers/teacher/routing_controller.js";
import { DesignEditorController } from "../../controllers/teacher/design_editor_controller.js";
import { ngQuillConfigProvider } from "../../helpers/util.js";

adpp.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

// Routing
adpp.config(function ($routeProvider) {
    $routeProvider
    // set route for the index page
        .when("/",
            {
                controller:  "RoutingController",
                templateUrl: "views/partials/teacher/ui-router.html"
            });
});

// Rich text editor configuration
adpp.config(["ngQuillConfigProvider", ngQuillConfigProvider]);

// Translations
adpp.config(function($translateProvider) {
    $translateProvider.useSanitizeValueStrategy("sanitizeParameters");

    $translateProvider.useStaticFilesLoader({
        prefix: "assets/i18n/", 
        suffix: ".json"
    });

    // Set default language
    $translateProvider.preferredLanguage("es");
});

adpp.config(["$provide", function($provide) {
    $provide.decorator("$locale", ["$delegate", function($delegate) {
        $delegate.NUMBER_FORMATS.GROUP_SEP = "";
        return $delegate;
    }]);
}]);

// Inject controllers into application
adpp.controller("RoutingController", 
    ["$scope", RoutingController]);
adpp.controller("HomeController",
    ["$scope", "TabStateService", "DesignsService",
        "ActivitiesService",
        "$http", "$uibModal", "$location", "$locale", 
        "$filter", "$socket", "$route", "$translate", HomeController]);
adpp.controller("TabsController", 
    ["$scope", "$http", "Notification", TabsController]);
adpp.controller("NewUsersController", 
    ["$scope", "$http", "Notification", IncomingUsersController]);
adpp.controller("DashboardController", 
    ["$scope", "ActivitiesService", "$http", "$timeout", "$uibModal", "Notification", DashboardController]);
adpp.controller("ConfirmModalController", 
    ["$uibModalInstance", ConfirmModalController]);
adpp.controller("ContentModalController", 
    ["$scope", "$uibModalInstance", "data", ContentModalController]);
adpp.controller("GroupController", 
    ["$scope", "$http", "Notification", GroupController]);
adpp.controller("DesignsDocController", 
    ["$scope", "DesignsService", "DocumentsService", "$http", "Notification", "$timeout", DesignsDocController]);
adpp.controller("ActivityController", 
    ["$scope", "ActivitiesService", "DesignsService", "SesionsService", "DocumentsService", "$filter", "$http", "Notification", "$timeout", ActivityController]);
adpp.controller("MonitorActivityController", 
    ["$scope", "$filter", "$http", "$window", "Notification","$uibModal", MonitorActivityController]);
adpp.controller("BrowseDesignsController", 
    ["$scope", "TabStateService", "DesignsService", "ActivitiesService", "$filter", "$http", BrowseDesignsController]);
adpp.controller("DesignEditorController", 
    ["$scope", "DesignsService", "ActivitiesService", "$filter", "$http", "Notification", "$timeout", DesignEditorController]);
adpp.controller("StagesController", ["$scope", "$http", "Notification", "$uibModal", StagesController]);

adpp.service("DialogService", function(ngDialog) {
    this.openDialog = function() {
        ngDialog.open({
            template:        "views/partials/teacher/warning-dialog.html",
            controller:      "DialogCtrl",
            className:       "ngdialog-theme-default",
            closeByDocument: true
        });
    };
  
    this.closeDialog = function() {
        ngDialog.close();
    };
});

adpp.controller("DialogCtrl", function($scope, DialogService) {
    $scope.openDialog = DialogService.openDialog;
    $scope.closeDialog = DialogService.closeDialog;
});


