"use strict";
// TODO: refactor these global variables
//var DASHBOARD_AUTORELOAD = window.location.hostname.indexOf("localhost") == -1;
//var DASHBOARD_AUTORELOAD_TIME = 15;

window.DIC = null;
window.warnDIC = {};

import "angular-toggle-switch";
import { ActivityStateService } from "../../services/activity-state.service.js";
import { ActivityCatalogService } from "../../services/activity-catalog.service.js";
import { DesignStateService } from "../../services/design-state.service.js";
import { DesignCatalogService } from "../../services/design-catalog.service.js";

import { io } from 'socket.io-client';
import * as Rx from 'rxjs';

var app = angular.module("TeacherApp", ["ngSanitize",
    "ui.bootstrap", "ui.multiselect", "timer", "ngFileUpload",
    "ui-notification", "ngQuill", "tableSort", "pascalprecht.translate", 
    "ngRoute", "checklist-model", "ngDialog", "toggle-switch"]
).factory("TabStateService", function() {
    var service = {};
    service.sharedTabState = { type: 0 };
    return service;
}).factory("ActivityStateService", ["$http", "SocketService", ActivityStateService])
    .factory("ActivityCatalogService", ["$http", ActivityCatalogService])
    .factory("DesignCatalogService", ["$rootScope", "$http", DesignCatalogService])
    .factory("DesignStateService", ["$rootScope", "$http", DesignStateService]);

import { LocalesController } from "../../controllers/common/locales.controller.js";
import { ActivityController } from "../../controllers/teacher/activity.controller.js";
import { DesignEditController } from "../../controllers/teacher/design-edit.controller.js";
import { BrowseDesignsController } from "../../controllers/teacher/browse-designs.controller.js";
import { ConfirmModalController } from "../../controllers/teacher/confirm_modal_controller.js";
import { ContentModalController } from "../../controllers/teacher/content_modal_controller.js";
import { CreateDesignController } from "../../controllers/teacher/create_design.controller.js";
import { DashboardController } from "../../controllers/teacher/dashboard.controller.js";
import { DesignAttachmentsController } from "../../controllers/teacher/design-attachments-controller.js";
import { DesignViewController } from "../../controllers/teacher/design-view.controller.js";
import { DocumentsController } from "../../controllers/teacher/documents.controller.js";
import { EthicsModalController } from "../../controllers/teacher/ethics_modal_controller.js";
import { ErrorController } from "../../controllers/teacher/error.controller.js";
import { VoidController } from "../../controllers/common/void.controller.js";
import { ngQuillConfigProvider } from "../../helpers/util.js";
import { DesignEditorController } from "../../controllers/teacher/design-editor.controller.js";

//import { GroupController } from "../../controllers/teacher/group_controller.js";
// import { DuplicateSesModalController } from "../../controllers/teacher/duplicate_ses_modal_controller.js";
// import { IncomingUsersController } from "../../controllers/teacher/incoming_users_controller.js";
// import { ManagementController } from "../../controllers/teacher/deprecated/management_controller.js";
// import { TabsController } from "../../controllers/teacher/deprecated/tabs_controller.js";
// import { MapSelectionModalController } from "../../controllers/teacher/map_selection_modal_controller.js";
// import { MonitorActivityController } from "../../controllers/teacher/deprecated/monitor_activity_controller.js";
// import { OptionsController } from "../../controllers/teacher/options_controller.js";
// import { RoutingController } from "../../controllers/teacher/deprecated/routing_controller.js";
// import { SesEditorController } from "../../controllers/teacher/ses_editor_controller.js";
// import { StagesController } from "../../controllers/teacher/stages_controller.js";
// import { DashboardRubricaController } from "../../controllers/teacher/dashboard_rubrica_controller.js";

import { SessionSocketService } from "../../services/session-socket.service.js";
app.factory('SessionSocketService', SessionSocketService);

app.factory("SocketService", function () {
    const websocketUrl = `${window.location.protocol}//${window.location.host}/teacher`;
    const socket = io(websocketUrl); // Connect to the /teacher namespace

    return {
        // Listen to generic events
        fromEvent: (eventName) => new Rx.Observable(observer => {
            // Subscribe to the event
            socket.on(eventName, (data) => observer.next(data));
        
            // Clean subscription on disconnection
            return () => socket.off(eventName);
        }),

        // Emit generic events
        emit: (eventName, data) => socket.emit(eventName, data),

        // Join a specific room
        joinRoom: (room) => {
            socket.emit("joinRoom", room);
        },

        // Leave a specific room
        leaveRoom: (room) => {
            socket.emit("leaveRoom", room);
        },
    };
});

/*app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);*/

import { TeacherRouter } from "./teacher-routes.js";
app.config(TeacherRouter);

app.run(function($rootScope, $location) {
    $rootScope.navigateTo = function(path) {
        //console.log(`[navigateTo] navigating to ${path}`);
        $rootScope.$applyAsync(() => {
            $location.path(path);
        });
    };
});

app.run(function($rootScope) {
    $rootScope.$on('$routeChangeError', function(event, current, previous, rejection) {
        console.error('Failed to load route:', current.originalPath);
    });
});


// Rich text editor configuration
app.config(["ngQuillConfigProvider", ngQuillConfigProvider]);

// Set up language
app.config(function($translateProvider) {
    // Configure how values are sanitized
    $translateProvider.useSanitizeValueStrategy("sanitizeParameters");

    // Load translation files from static assets
    $translateProvider.useStaticFilesLoader({
        prefix: "assets/locales/", 
        suffix: ".json"
    });

    // Automatically determine the preferred language based on the browser
    $translateProvider.determinePreferredLanguage();

    // Fallback to a default language if the browser's language is not supported
    $translateProvider.fallbackLanguage("en");
});

// Inject controllers into application
app.controller("LocalesController", 
    ["$translate", "$scope", "$rootScope", LocalesController]); 
app.controller("ActivityController", 
    ["$scope", "$filter", "$http", "Notification", "$timeout", 
        "ActivityStateService", "ActivityCatalogService", "DesignCatalogService", ActivityController]);
app.controller("DesignEditController", 
    ["$scope", "$routeParams", "DesignStateService", "$filter", "$http", "Notification", 
        "$timeout", "ActivityStateService", "DesignCatalogService", DesignEditController]);
app.controller("BrowseDesignsController", 
    ["$scope", "$routeParams", "TabStateService", "DesignStateService", 
        "ActivityStateService", "DesignCatalogService", 
        "$filter", "$http", BrowseDesignsController]); 
app.controller("ConfirmModalController", 
    ["$uibModalInstance", ConfirmModalController]);
app.controller("ContentModalController", 
    ["$scope", "$uibModalInstance", "data", ContentModalController]); 
app.controller("CreateDesignController", 
    ["$scope", "$http", "DesignCatalogService", CreateDesignController]);
app.controller("DashboardController", 
    ["$scope", "$routeParams", "$http", "$timeout", "$uibModal", "ActivityStateService",
        "DesignCatalogService", "$translate", DashboardController]);  
app.controller("DesignAttachmentsController", 
    ["$scope", "DesignStateService" ,"$http", "Notification", "$timeout", DesignAttachmentsController]);
app.controller("DesignViewController", 
    ["$scope", "$routeParams", "DesignCatalogService", DesignViewController]);
app.controller("DocumentsController", 
    ["$scope", "$http", "Notification", "$timeout", "ActivityStateService",
        DocumentsController]);
app.controller("EthicsModalController", 
    ["$scope", "$http", "$uibModalInstance", "Notification", "data", EthicsModalController]);
app.controller("ErrorController", 
    ["$scope", "$window", "$routeParams",
        ErrorController]);
app.controller("DesignEditorController", 
    ["$scope", "$routeParams", "DesignStateService", "DesignCatalogService",
        DesignEditorController]);         
app.controller("VoidController", [VoidController]);        
/*app.controller("RoutingController", 
    ["$scope", RoutingController]);
app.controller("ManagementController",
    ["$scope", "TabStateService", "DesignStateService",
        "$http", "$uibModal", "$location", "$locale", 
        "$filter", "$socket", "$route", "$translate", "ActivityStateService",
        "ActivityCatalogService", "DesignCatalogService",
        ManagementController]);*/
   
/*app.controller("TabsController", 
    ["$scope", "$http", "Notification", TabsController]);*/       
/* app.controller("SesEditorController", 
    ["$scope", "$http", "Notification", "ActivityStateService", SesEditorController]); */
/* app.controller("NewUsersController", 
    ["$scope", "$http", "Notification", "ActivityStateService", IncomingUsersController]); */
/*app.controller("MapSelectionModalController", 
    ["$scope", "$uibModalInstance", MapSelectionModalController]);*/

/*app.controller("DuplicateSesModalController", 
    ["$scope", "$http", "$uibModalInstance", "data", DuplicateSesModalController]);
app.controller("GroupController", 
    ["$scope", "$http", "Notification", "ActivityStateService", GroupController]);*/
/*app.controller("MonitorActivityController", 
    ["$scope", "$filter", "$http", "$window", "Notification","$uibModal", "ActivityStateService",
        MonitorActivityController]);*/

/*app.controller("OptionsController", 
    ["$scope", "$http", "Notification", "ActivityStateService", OptionsController]); */
/*app.controller("DashboardRubricaController", 
    ["$scope", DashboardRubricaController]);
app.controller("StagesController", 
    ["$scope", "$http", "Notification", "$uibModal", "ActivityStateService", StagesController]);*/

    
app.service("DialogService", function(ngDialog) {
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

app.controller("DialogCtrl", function($scope, DialogService) {
    $scope.openDialog = DialogService.openDialog;
    $scope.closeDialog = DialogService.closeDialog;
});

import { connectedUsersDirective, ConnectedUsersDirectiveController } from "../../directives/connected-users.directive.js";
import { activityControlsDirective } from "../../directives/activity-controls.directive.js";
import { phaseStateDirective } from "../../directives/phase-state.directive.js";
import { groupPhaseTableDirective } from "../../directives/group-phase-table.directive.js";
import { individualPhaseTableDirective } from "../../directives/individual-phase-table.directive.js";
import phaseModeValueAdapter from "../../directives/phase-mode-value-adapter.directive.js";

app.directive("connectedUsers", connectedUsersDirective);
app.directive("activityControls", activityControlsDirective);
app.directive("phaseState", phaseStateDirective);
app.directive("groupPhaseTable", groupPhaseTableDirective);
app.directive("individualPhaseTable", individualPhaseTableDirective);
app.directive("phaseModeValueAdapter", phaseModeValueAdapter);

app.controller("ConnectedUsersDirectiveController", ["$scope", "ActivityStateService", 
    ConnectedUsersDirectiveController]);

import { activityDescriptionComponent } from "../../components/activity-description.component.js";
import { designDescriptionComponent } from "../../components/design-description.component.js";
import { phaseDescriptionComponent } from "../../components/phase-description.component.js";
import rankingItemEditorComponent from "../../components/ranking-item-editor.component.js";
import sdItemEditorComponent from "../../components/sd-item-editor.component.js";
import groupingModeSelectorComponent from "../../components/grouping-mode-selector.component.js";
import previousPhasesSelectorComponent from "../../components/previous-phases-selector.component.js";
import numericInputWithSpinbuttonComponent from "../../components/numeric-input-with-spinbutton.component.js";

app.component('activityDescription', activityDescriptionComponent);
app.component('designDescription', designDescriptionComponent);
app.component('phaseDescription', phaseDescriptionComponent);
app.component('rankingItemEditor', rankingItemEditorComponent);
app.component('sdItemEditor', sdItemEditorComponent);
app.component('groupingModeSelector', groupingModeSelectorComponent);
app.component('previousPhasesSelector', previousPhasesSelectorComponent);
app.component('numericInputWithSpinbutton', numericInputWithSpinbuttonComponent);
