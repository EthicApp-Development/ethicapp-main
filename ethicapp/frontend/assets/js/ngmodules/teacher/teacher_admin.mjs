"use strict";
// TODO: refactor these global variables
var DASHBOARD_AUTORELOAD = window.location.hostname.indexOf("localhost") == -1;
var DASHBOARD_AUTORELOAD_TIME = 15;

var designId = { id: null };
var launchId = { id: null, title: null, type: null };
var tabSel = { type: 0 };

window.DIC = null;
window.warnDIC = {};

var adpp = angular.module("Admin", ["ngSanitize", "btford.socket-io",
    "api-params", "ui.bootstrap", "ui.multiselect", "nvd3", "timer",
    "ui-notification", "ngQuill", "tableSort", "pascalprecht.translate", 
    "ngRoute", "checklist-model", "ngDialog"]
);

import { ActivityController } from "../../controllers/teacher/activity_controller.js";
import { BrowseDesignsController } from "../../controllers/teacher/browse_designs_controller.js";
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
import { LoginController } from "../../controllers/login_controller.js";
import { ngQuillConfigProvider } from "../../helpers/util.js";

adpp.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

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
adpp.controller("RouteCtrl", RoutingController);
adpp.controller("ManagementController", ManagementController);
adpp.controller("TabsController", TabsController);
adpp.controller("DocumentsController", DocumentsController);
adpp.controller("SesEditorController", SesEditorController);
adpp.controller("NewUsersController", IncomingUsersController);
adpp.controller("DashboardController", DashboardController);
adpp.controller("MapSelectionModalController", MapSelectionModalController);
adpp.controller("ContentModalController", ContentModalController);
adpp.controller("EthicsModalController", EthicsModalController);
adpp.controller("DuplicateSesModalController", DuplicateSesModalController);
adpp.controller("GroupController", GroupController);
adpp.controller("DesignsDocController", DesignsDocController);
adpp.controller("ActivityController", ActivityController);
adpp.controller("MonitorActivityController", MonitorActivityController);
adpp.controller("BrowseDesignsController", BrowseDesignsController);
adpp.controller("StagesEditController", StagesEditController);
adpp.controller("OptionsController", OptionsController);
adpp.controller("DashboardRubricaController", DashboardRubricaController);
adpp.controller("LoginController", LoginController);

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

// Routing
adpp.config(function ($routeProvider) {
    $routeProvider
    // set route for the index page
        .when("/",
            {
                controller:  "RouteCtrl",
                templateUrl: "views/partials/teacher/ui-router.html"
            });
});
