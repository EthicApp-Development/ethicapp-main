import { LocalesController } from "../../controllers/common/locales.controller.js";
import { EthicsController } from "../../controllers/student/ethics.controller.js";
import { PhaseController } from "../../controllers/student/phase.controller.js";
import { DirectContentController } from "../../controllers/student/direct-content.controller.js";
import { LinksFilter } from "../../filters/links.filter.js";
import { BindHTMLCompile } from "../../directives/bind-html-compile.directive.js";

let BASE_APP = window.location.href.replace("ethics", "");

let app = angular.module(
    "StudentEthics",
    ["ngSanitize", "ui.bootstrap", "ui.tree", "btford.socket-io",
       "pascalprecht.translate",  "ui-notification", "luegg.directives"]);

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

import SocketService from '../../services/socket.service.js';
import StudentActivityStateService from '../../services/student-activity-state.service.js';

app.factory("SocketService", function () { return SocketService } );
app.factory("StudentSocketService", ["SocketService", function (SocketService) {
    return SocketService('student');
}]);
app.factory("StudentActivityStateService", ["$http", 
    "StudentSocketService", StudentActivityStateService]);

app.controller("LocalesController", 
    ["$translate", "$scope", "$rootScope", LocalesController]); 
app.controller(
    "EthicsController",
    ["$scope", "$http", "$timeout", "StudentSocketService", 
        "Notification", "$sce", "$uibModal", "$translate",
    EthicsController]);

app.controller(
    "PhaseController",
    ["$scope", "$http", "$timeout", "StudentActivityStateService", 
        "$uibModal", "$translate",
    PhaseController]);

app.controller("DirectContentController",
    ["$scope", "$uibModalInstance", "data", DirectContentController]);

app.directive("bindHtmlCompile", ["$compile", BindHTMLCompile]);
app.filter("linkfy", LinksFilter);
