"use strict";

import { MatchFieldDirective } from "../../directives/match-field.directive.js";
import { InstitutionRequired } from "../../directives/institution-required.directive.js";
import { LoginController } from "../../controllers/common/login_controller.js";
import { RegisterController } from "../../controllers/common/register_controller.js";
import { ProfileController } from "../../controllers/common/profile_controller.js";
import { LocalesController } from "../../controllers/common/locales_controller.js";

let ngapp_user_common = angular.module("UserCommon", 
    ["ui.bootstrap", "ngRoute", "pascalprecht.translate"]);

ngapp_user_common.config(function($compileProvider) {
    $compileProvider.debugInfoEnabled(true);
});

ngapp_user_common.config(function($translateProvider) {
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

ngapp_user_common.directive("matchField", 
    MatchFieldDirective);
ngapp_user_common.directive("institutionRequired",
    InstitutionRequired);

ngapp_user_common.controller("LocalesController", 
    ["$translate", "$scope", "$rootScope", LocalesController]);    
ngapp_user_common.controller("LoginController", 
    ["$scope", "$http", "$window", LoginController]);
ngapp_user_common.controller("RegisterController", 
    ["$scope", "$http", RegisterController]);
ngapp_user_common.controller("ProfileController",
    ["$scope", "$http", ProfileController]);

export default ngapp_user_common;