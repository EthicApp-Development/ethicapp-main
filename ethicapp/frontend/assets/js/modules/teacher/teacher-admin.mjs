import 'angular-animate';
import 'angularjs-toast';
import "angular-toggle-switch";
import { ActivityStateService } from "../../services/activity-state.service.js";
import { ActivityCatalogService } from "../../services/activity-catalog.service.js";
import { DesignStateService } from "../../services/design-state.service.js";
import { DesignCatalogService } from "../../services/design-catalog.service.js";
import { CasesCatalogService } from "../../services/cases-catalog.service.js";
import { TeacherGroupChatService } from "../../services/teacher-group-chat.service.js";
import UserProfileService from "../../services/user-profile.service.js";
import SocketService from '../../services/socket.service.js';

var app = angular.module("TeacherApp", ["ngSanitize",
    "ui.bootstrap", "timer", "ngFileUpload",
    "ui-notification", "tableSort", "pascalprecht.translate",
    "ngRoute", "checklist-model", "ngDialog", "toggle-switch", 'angularjsToast',
    'ngAnimate']
);

app.factory("SocketService", function () { return SocketService } );
app.factory("TeacherSocketService", ["SocketService", function (SocketService) {
    return SocketService('teacher');
}]);

app.factory("ActivityStateService", ["$http", "TeacherSocketService", ActivityStateService])
    .factory("TeacherGroupChatService", ["$http", "TeacherSocketService", TeacherGroupChatService])
    .factory("ActivityCatalogService", ["$http", ActivityCatalogService])
    .factory("DesignCatalogService", ["$rootScope", "$http", DesignCatalogService])
    .factory("DesignStateService", ["$rootScope", "$http", DesignStateService])
    .factory("UserProfileService", ["$http", "$rootScope", "Upload", UserProfileService])
    .factory("CasesCatalogService", ["$http", CasesCatalogService]);

import { LocalesController } from "../../controllers/common/locales.controller.js";
import { ActivityController } from "../../controllers/teacher/activity.controller.js";
import { ActivityReportsController } from "../../controllers/teacher/activity-reports.controller.js";
import { BrowseDesignsController } from "../../controllers/teacher/browse-designs.controller.js";
import { CreateDesignController } from "../../controllers/teacher/create_design.controller.js";
import { DashboardController } from "../../controllers/teacher/dashboard.controller.js";
import { ErrorController } from "../../controllers/teacher/error.controller.js";
import { VoidController } from "../../controllers/common/void.controller.js";
import { DesignEditorController } from "../../controllers/teacher/design-editor.controller.js";
import { DesignViewerController } from "../../controllers/teacher/design-viewer.controller.js";
import { CasesController } from "../../controllers/teacher/cases.controller.js";
import { ProfileController } from "../../controllers/teacher/profile.controller.js";

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

// Set up language
app.config(function($translateProvider) {
    // Configure how values are sanitized
    $translateProvider.useSanitizeValueStrategy("sanitizeParameters");

    // Load translation files from static assets
    $translateProvider.useStaticFilesLoader({
        prefix: "assets/locales/", 
        suffix: ".json"
    });

    $translateProvider.registerAvailableLanguageKeys(["en_US", "es_CL"], {
        "en": "en_US",
        "en_*": "en_US",
        "es": "es_CL",
        "es_*": "es_CL",
        "*": "en_US",
    });

    // Automatically determine the preferred language based on the browser
    $translateProvider.determinePreferredLanguage();

    // Fallback to a default language if the browser's language is not supported
    $translateProvider.fallbackLanguage("en_US");
});

const config = toastProvider => {
    toastProvider.configure({
      maxToast: 1,
      timeout: 5 * 1000,
      dismissible: true,
      insertFromTop: true,
    });
  };
  
config.$inject = ['toastProvider'];
app.config(config);

// Inject controllers into application
app.controller("LocalesController", 
    ["$translate", "$scope", "$rootScope", LocalesController]); 
app.controller("ActivityController", 
    ["$scope", "$http", "ActivityCatalogService", "DesignCatalogService", ActivityController]);
app.controller("ActivityReportsController",
    ["$scope", "$routeParams", "$window", ActivityReportsController]);
app.controller("BrowseDesignsController", 
    ["$scope", "$routeParams", "toast", "$translate", "ActivityStateService", "DesignCatalogService",
        "$timeout", "$window",
        BrowseDesignsController]); 
app.controller("CreateDesignController", 
    ["$scope", "DesignCatalogService", "UserProfileService", CreateDesignController]);
app.controller("DashboardController", 
    ["$scope", "$routeParams", "$http", "$translate", "$timeout", "$uibModal",
        "ActivityStateService", "ActivityCatalogService", "DesignCatalogService",
        "CasesCatalogService", "TeacherGroupChatService", DashboardController]);
app.controller("DesignViewerController", 
    ["$scope", "$routeParams", "DesignCatalogService", "CasesCatalogService", DesignViewerController]);
app.controller("CasesController",
    ["$scope", "$routeParams", "$window", "CasesCatalogService", CasesController]);
app.controller("ErrorController", 
    ["$scope", "$window", "$routeParams",
        ErrorController]);
app.controller("DesignEditorController", 
    ["$scope", "$translate", "$timeout", "$routeParams", "DesignStateService", 
        "DesignCatalogService", "CasesCatalogService", "toast", DesignEditorController]);         
app.controller("VoidController", [VoidController]);
app.controller("ProfileController", ["$scope", "$translate", "toast", "UserProfileService", ProfileController]);

app.service("DialogService", function(ngDialog) {
    this.openDialog = function() {
        ngDialog.open({
            template:        "views/templates/teacher/warning-dialog.html",
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
import { phaseDescriptionDirective } from "../../directives/phase-description.directive.js";
import { phaseStateDirective } from "../../directives/phase-state.directive.js";
import { groupPhaseTableDirective } from "../../directives/group-phase-table.directive.js";
import { individualPhaseTableDirective } from "../../directives/individual-phase-table.directive.js";
import phaseModeValueAdapter from "../../directives/phase-mode-value-adapter.directive.js";
import phaseDeleterDirective from "../../directives/phase-deleter.directive.js";
import validateDesignDirective from '../../directives/validate-design.directive.js';
import validatePhaseDirective from '../../directives/validate-phase.directive.js';
import { designViewerDirective } from '../../directives/design-viewer.directive.js';
import copyToClipboardDirective from '../../directives/copy-to-clipboard.directive.js';
import tooltipDirective from   '../../directives/tooltip.directive.js';

app.directive("connectedUsers", connectedUsersDirective);
app.directive("activityControls", activityControlsDirective);
app.directive('phaseDescription', phaseDescriptionDirective);
app.directive("phaseState", phaseStateDirective);
app.directive("groupPhaseTable", groupPhaseTableDirective);
app.directive("individualPhaseTable", individualPhaseTableDirective);
app.directive("phaseModeValueAdapter", phaseModeValueAdapter);
app.directive("validateDesign", validateDesignDirective);
app.directive("validatePhase", validatePhaseDirective);
app.directive("designViewer", designViewerDirective);
app.directive("tooltip", ["$translate", "$timeout", tooltipDirective]);
app.directive("copyToClipboard", copyToClipboardDirective);
app.directive("phaseDeleter", ["$translate", phaseDeleterDirective]);

app.controller("ConnectedUsersDirectiveController", ["$scope", "ActivityStateService", 
    ConnectedUsersDirectiveController]);

import { activityDescriptionComponent } from "../../components/activity-description.component.js";
import { designDescriptionComponent } from "../../components/design-description.component.js";
import rankingItemEditorComponent from "../../components/ranking-item-editor.component.js";
import sdItemEditorComponent from "../../components/sd-item-editor.component.js";
import groupingModeSelectorComponent from "../../components/grouping-mode-selector.component.js";
import previousPhasesSelectorComponent from "../../components/previous-phases-selector.component.js";
import numericInputWithSpinbuttonComponent from "../../components/numeric-input-with-spinbutton.component.js";
import phaseMoverComponent from "../../components/phase-mover.component.js";
import itemDeleterComponent from "../../components/item-deleter.component.js";
import itemDuplicatorComponent from "../../components/item-duplicator.component.js";
import designErrorSummaryComponent from "../../components/design-error-summary.component.js";
import itemMoverComponent from '../../components/item-mover.component.js';
import designItemComponent from '../../components/design-item.component.js';
import caseCardComponent from "../../components/case-card.component.js";
import caseFormEditorComponent from "../../components/case-form-editor.component.js";
import phaseInstructionsEditComponent from "../../components/phase-instructions-edit.component.js";
import teacherGroupChatComponent from "../../components/teacher-group-chat.component.js";

app.component('activityDescription', activityDescriptionComponent);
app.component('designDescription', designDescriptionComponent);
app.component('groupingModeSelector', groupingModeSelectorComponent);
app.component('previousPhasesSelector', previousPhasesSelectorComponent);
app.component('numericInputWithSpinbutton', numericInputWithSpinbuttonComponent);
app.component('phaseMover', phaseMoverComponent);
app.component('itemMover', itemMoverComponent);
app.component('itemDeleter', itemDeleterComponent);
app.component('itemDuplicator', itemDuplicatorComponent);
app.component('designErrorSummary', designErrorSummaryComponent);
app.component('rankingItemEditor', rankingItemEditorComponent);
app.component('sdItemEditor', sdItemEditorComponent);
app.component('designItem', designItemComponent);
app.component("caseCard", caseCardComponent);
app.component("caseFormEditor", caseFormEditorComponent);
app.component("phaseInstructionsEdit", phaseInstructionsEditComponent);
app.component("teacherGroupChat", teacherGroupChatComponent);

import { userRolesFilter } from '../../filters/user-roles.filter.js';
app.filter("roleTranslate", ["$translate", userRolesFilter]);
