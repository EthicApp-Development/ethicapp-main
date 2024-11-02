"use strict";

import { LocalesController } from "../../controllers/common/locales_controller.js";
import { SessionsListController } from "../../controllers/student/sessions-list-controller.js";
import { LangFilter } from "../../filters/lang-filter.js";

let adpp = angular.module("SessionsList", 
    ["ui.bootstrap", "btford.socket-io", "angular-intro", "pascalprecht.translate"]);

adpp.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

adpp.filter("mylang", LangFilter);

adpp.config(function($translateProvider) {
    $translateProvider.useStaticFilesLoader({
        prefix: "assets/locales/", 
        suffix: ".json",
    });

    // Detect browser language
    $translateProvider.determinePreferredLanguage();
    
    // Set default language
    $translateProvider.fallbackLanguage("en");

    $translateProvider.useSanitizeValueStrategy("escape"); 
});

adpp.controller("LocalesController", 
    ["$translate", "$scope", "$rootScope", LocalesController]);

adpp.controller("SessionsListController",
    ["$scope", "$http", "$socket", "$uibModal", "ngIntroService", SessionsListController]
);

export default adpp;