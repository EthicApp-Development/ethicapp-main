"use strict";
import { DirectContentController } from "../../controllers/student/direct-content-controller.js";
import { LinksFilter } from "../../filters/links-filter.js";
import { LangFilter } from "../../filters/lang-filter.js";
import { BindHTMLCompile } from "../../directives/bind-html-compile.js";
import { RolePlayingController } from "../../controllers/student/role-playing-controller.js";

let BASE_APP = window.location.href.replace("role-playing", "");

let app = angular.module("StudentRolePlaying", 
    ["ngSanitize", "ui.bootstrap", "ui.tree", "btford.socket-io", 
        "angular-intro", "ui-notification", "luegg.directives"]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller("RolePlayingController", ["$scope", "$http", "$timeout", "$socket", 
    "Notification", "$sce", "$uibModal", "ngIntroService", 
    RolePlayingController]);

app.controller("DirectContentController",
    ["$scope", "$uibModalInstance", "data", DirectContentController]);

app.filter("lang", LangFilter);
app.directive("bindHtmlCompile", ["$compile", BindHTMLCompile]);
app.filter("linkfy", LinksFilter);