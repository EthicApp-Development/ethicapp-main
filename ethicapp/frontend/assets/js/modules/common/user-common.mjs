"use strict";

import { MatchFieldDirective } from "../../directives/match-field.directive.js";
import { InstitutionRequired } from "../../directives/institution-required.directive.js";
import { LoginController } from "../../controllers/common/login.controller.js";
import { RegistrationsController } from "../../controllers/common/registrations.controller.js";
import { CredentialsController } from "../../controllers/common/credentials.controller.js";
import { LocalesController } from "../../controllers/common/locales.controller.js";
import { ErrorsController } from "../../controllers/common/errors.controller.js";
import { VoidController } from "../../controllers/common/void.controller.js";

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
ngapp_user_common.controller("RegistrationsController", 
    ["$scope", "$http", RegistrationsController]);
ngapp_user_common.controller("ErrorsController",
    ["$scope", "$http", ErrorsController]);    
ngapp_user_common.controller("CredentialsController",
    ["$scope", "$http", "$window", CredentialsController]);
ngapp_user_common.controller("VoidController",
    [VoidController]);

export default ngapp_user_common;