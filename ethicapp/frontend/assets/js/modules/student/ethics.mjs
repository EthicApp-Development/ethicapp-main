"use strict";
import { EthicsController } from "../../controllers/student/ethics.controller.js";
import { DirectContentController } from "../../controllers/student/direct-content.controller.js";
import { LinksFilter } from "../../filters/links.filter.js";
import { LangFilter } from "../../filters/lang.filter.js";
import { BindHTMLCompile } from "../../directives/bind-html-compile.directive.js";

let BASE_APP = window.location.href.replace("ethics", "");

let app = angular.module(
    "StudentEthics",
    ["ngSanitize", "ui.bootstrap", "ui.tree", "btford.socket-io",
        "angular-intro", "ui-notification", "luegg.directives"]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller(
    "EthicsController",
    ["$scope", "$http", "$timeout", "$socket", 
        "Notification", "$sce", "$uibModal","ngIntroService",
    EthicsController]);

app.controller("DirectContentController",
    ["$scope", "$uibModalInstance", "data", DirectContentController]);

app.directive("bindHtmlCompile", ["$compile", BindHTMLCompile]);
app.filter("linkfy", LinksFilter);
app.filter("lang", LangFilter);