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
        "ui-notification", "luegg.directives"]);

import SocketService from '../../services/socket.service.js';
app.factory("SocketService", function () { return SocketService } );
app.factory("StudentSocketService", ["SocketService", function (SocketService) {
    return SocketService('student');
}]);

app.controller(
    "EthicsController",
    ["$scope", "$http", "$timeout", "StudentSocketService", 
        "Notification", "$sce", "$uibModal",
    EthicsController]);

app.controller("DirectContentController",
    ["$scope", "$uibModalInstance", "data", DirectContentController]);

app.directive("bindHtmlCompile", ["$compile", BindHTMLCompile]);
app.filter("linkfy", LinksFilter);
app.filter("lang", LangFilter);