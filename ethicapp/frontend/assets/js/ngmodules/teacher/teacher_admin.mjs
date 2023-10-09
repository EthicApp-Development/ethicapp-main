"use strict";
// TODO: refactor these global variables
//var DASHBOARD_AUTORELOAD = window.location.hostname.indexOf("localhost") == -1;
//var DASHBOARD_AUTORELOAD_TIME = 15;

//var designId = { id: null };
//var launchId = { id: null, title: null, type: null };
//var tabSel = { type: 0 };

window.DIC = null;
window.warnDIC = {};

var adpp = angular.module("Admin", ["ngSanitize", "btford.socket-io", 
    "api-params", "ui.bootstrap", "ui.multiselect", "nvd3", "timer",
    "ui-notification", "ngQuill", "tableSort", "pascalprecht.translate", 
    "ngRoute", "checklist-model", "ngDialog"]
).factory('TabStateService', function() {
    var service = {};
    service.sharedTabState = { type: 0 };
    return service;
}).factory('ActivityStateService', function() {
    var service = {};
    service.activityState = { 
        id: null,
        title: null,
        type: null,
        dashboardAutoreload: true,
        dashboardAutoreloadTime: 15 
    };
    return service; 
}).factory('DesignStateService', function() {
    var service = {};
    service.designState = { id: null };
    return service;
});

import { ActivityController } from "../../controllers/teacher/activity_controller.js";
import { StagesController } from "../../controllers/teacher/stages_controller.js";
import { BrowseDesignsController } from "../../controllers/teacher/browse_designs_controller.js";
import { ConfirmModalController } from "../../controllers/teacher/confirm_modal_controller.js";
import { ContentModalController } from "../../controllers/teacher/content_modal_controller.js";
import { DashboardController } from "../../controllers/teacher/dashboard_controller.js";
import { DesignsDocController } from "../../controllers/teacher/designs_doc_controller.js";
import { DocumentsController } from "../../controllers/teacher/documents_controller.js";
import { DuplicateSesModalController } from "../../controllers/teacher/duplicate_ses_modal_controller.js";
import { EthicsModalController } from "../../controllers/teacher/ethics_modal_controller.js";
import { GroupController } from "../../controllers/teacher/group_controller.js";
import { IncomingUsersController } from "../../controllers/teacher/incoming_users_controller.js";
import { ManagementController } from "../../controllers/teacher/management_controller.js";
import { TabsController } from "../../controllers/tabs_controller.js";
import { MapSelectionModalController } from "../../controllers/teacher/map_selection_modal_controller.js";
import { MonitorActivityController } from "../../controllers/teacher/monitor_activity_controller.js";
import { OptionsController } from "../../controllers/teacher/options_controller.js";
import { RoutingController } from "../../controllers/teacher/routing_controller.js";
import { SesEditorController } from "../../controllers/teacher/ses_editor_controller.js";
import { StagesEditController } from "../../controllers/teacher/stages_edit_controller.js";
import { DashboardRubricaController } from "../../controllers/teacher/dashboard_rubrica_controller.js";
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
    $translateProvider.useSanitizeValueStrategy('sanitizeParameters');

    $translateProvider.useStaticFilesLoader({
        prefix: 'assets/i18n/', 
        suffix: '.json'
    });

    // Set default language
    $translateProvider.preferredLanguage('es');
});

// Inject controllers into application
adpp.controller("RoutingController", 
    ['$scope', RoutingController]);
adpp.controller("ManagementController",
    ['$scope', 'TabStateService', 'DesignStateService',
    'ActivityStateService',
    '$http', '$uibModal', '$location', '$locale', 
    '$filter', '$socket', '$route', '$translate', ManagementController]);
adpp.controller("TabsController", 
    ['$scope', '$http', 'Notification', TabsController]);
adpp.controller("DocumentsController", 
    ['$scope', '$http', 'Notification', '$timeout', DocumentsController]);
adpp.controller("SesEditorController", 
    ['$scope', '$http', 'Notification', SesEditorController]);
adpp.controller("NewUsersController", 
    ['$scope', '$http', 'Notification', IncomingUsersController]);
adpp.controller("DashboardController", 
    ['$scope', 'ActivityStateService', '$http', '$timeout', '$uibModal', 'Notification', DashboardController]);
adpp.controller("MapSelectionModalController", 
    ['$scope', '$uibModalInstance', MapSelectionModalController]);
adpp.controller("ConfirmModalController", 
    ['$uibModalInstance', ConfirmModalController]);
adpp.controller("ContentModalController", 
    ['$scope', '$uibModalInstance', 'data', ContentModalController]);
adpp.controller("EthicsModalController", 
    ['$scope', '$http', '$uibModalInstance', 'Notification', 'data', EthicsModalController]);
adpp.controller("DuplicateSesModalController", 
    ['$scope', '$http', '$uibModalInstance', 'data', DuplicateSesModalController]);
adpp.controller("GroupController", 
    ['$scope', '$http', 'Notification', GroupController]);
adpp.controller("DesignsDocController", 
    ['$scope', 'DesignStateService' ,'$http', 'Notification', '$timeout', DesignsDocController]);
adpp.controller("ActivityController", 
    ['$scope', 'ActivityStateService', '$filter', '$http', 'Notification', '$timeout', ActivityController]);
adpp.controller("MonitorActivityController", 
    ['$scope', '$filter', '$http', '$window', 'Notification','$uibModal', MonitorActivityController]);
adpp.controller("BrowseDesignsController", 
    ['$scope', 'TabStateService', 'DesignStateService', 'ActivityStateService', '$filter', '$http', BrowseDesignsController]);
adpp.controller("StagesEditController", 
    ['$scope', 'DesignStateService', 'ActivityStateService', '$filter', '$http', 'Notification', '$timeout', StagesEditController]);
adpp.controller("OptionsController", 
    ['$scope', '$http', 'Notification', OptionsController]);
adpp.controller("DashboardRubricaController", 
    ['$scope', DashboardRubricaController]);
adpp.controller("StagesController", ['$scope', '$http', 'Notification', '$uibModal', StagesController]);

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


