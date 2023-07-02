"use strict";

var adpp = angular.module("SesList", ["ui.bootstrap", "btford.socket-io", "angular-intro"]);

adpp.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

adpp.filter("mylang", function () {
    filt.$stateful = true;
    return filt;

    function filt(label) {
        if (window.DIC == null) return;
        if (window.DIC[label]) return window.DIC[label];
        if (!window.warnDIC[label]) {
            console.warn("Cannot find translation for ", label);
            window.warnDIC[label] = true;
        }
        return label;
    }
});

adpp.controller("SesListController",
    ["$scope", "$http", "$socket", "$uibModal", "ngIntroService",
        function ($scope, $http, $socket, $uibModal, ngIntroService) {
            var self = $scope;
            self.sessions = [];
            self.sesOpen = false;
            self.invCode = "";
            self.showCodeError = false;
            self.currTab = false;
            self.sesTypeTab = false;
            self.routes = {
                L: "to-visor",
                M: "to-semantic",
                S: "to-select",
                E: "to-differential",
                R: "to-role",
                T: "to-diff",
                J: "to-role"
            };

            self.init = function () {
                self.updateSessions();
                $socket.on("stateChange", function (data) {
                    console.log("SOCKET.IO", data);
                    self.updateSessions();
                });
                self.showName();
                
            };

            self.currentSessions = function(){
                return  self.sessions.filter(self.checkStatus);
            };

            self.checkStatus = function(session){
                if(self.sesTypeTab) return session["status"] == 3;
                else return session["status"] != 3;
                
            };

            self.changeTab = function(tab){
                if(tab)  self.currTab = false;        
                else self.currTab = true; 

            };

            self.changeTypeTab = function(tab){
                if(tab)  self.sesTypeTab = false;        
                else self.sesTypeTab = true; 
        
            };

            self.showName = function () {
                $http.post("get-my-name").success(function (data) {
                    self.mail = data.mail;
                    self.rol = data.role;
                    self.username = data.name;
                    // self.mylang = data.lang;
                    self.mylang = data.lang == "spanish" ? "ES_CL/spanish" : "EN_US/english";
                    self.updateLang(self.mylang);
                });
            };


            self.updateSessions = function () {
                $http({ url: "get-session-list", method: "post" }).success(function (data) {
                    self.sessions = data;
                });
            };

            self.openSes = function () {
                self.sesOpen = true;
            };

            self.enterCode = function () {
                if (self.checkCode(self.invCode.toLowerCase())) {
                    var postdata = {
                        code:   self.invCode.toLowerCase(),
                        device: self.getDeviceInfo()
                    };
                    $http.post("enter-session-code", postdata).success(function (data) {
                        if (data.status == "ok") {
                            window.location.replace(data.redirect);
                        } else {
                            $uibModal.open({
                                template: 
                                '<div><div class="modal-header"><h4>Error</h4></div>' + 
                                '<div class="modal-body"><p>El código ingresado no es válido' +
                                " o la sesión no admite nuevos usuarios</p></div></div>"
                            });
                        }
                    });
                }
            };

            self.checkCode = function (code) {
                console.log(self.sessions, code);
                var s = self.sessions.find(function (e) {
                    return e.code == code;
                });
                console.log(s);
                if (s == null) return true;
                var url = self.routes[s.type] + "?sesid=" + s.id;
                window.location.replace(url);
                return false;
            };

            self.updateLang = function (lang) {
                $http.get("assets/i18n/" + lang + ".json").success(function (data) {
                    window.DIC = data;
                });
            };

            self.changeLang = function () {
                var newlang = self.mylang == "EN_US/english" ? "spanish" : "english";
                $http.post("update-lang", { lang: newlang }).success(function () {
                    self.showName();
                });
            };

            var introOptions = {
                steps: [{
                    element: "#seslistdiv",
                    intro:   "Aqui debajo se muestran todas las sesiones que tienes disponibles" + 
                            ". Al apretar en una de ellas puedes ingresar a la actividad",
                    position: "right"
                }, {
                    element: "#codebox",
                    intro:   "Para ingresar a una nueva actividad, debes ingresar el código de " + 
                            "una sesión que te entrega el/la profesor/a en este campo."
                }, {
                    element: "#codeboxbtn",
                    intro:   "Usando este botón ingresas a la sesión indicada por el código"
                }, {
                    element: "#changelang",
                    intro:   "Con este botón puedes cambiar el idioma. Using this " + 
                            "button you can change the language",
                    position: "left"
                }, {
                    element: "#topbtnlist",
                    intro:   "Finalmente usando el botón de ayuda puedes volver a " + 
                            "ver esta ayuda y con el botón de salir puedes cerrar sesión.",
                    position: "left"
                }],
                showStepNumbers:    false,
                showBullets:        false,
                exitOnOverlayClick: true,
                exitOnEsc:          true,
                tooltipPosition:    "auto",
                nextLabel:          "Siguiente",
                prevLabel:          "Anterior",
                skipLabel:          "Salir",
                doneLabel:          "Listo"
            };

            ngIntroService.setOptions(introOptions);

            self.startTour = function () {
                ngIntroService.start();
            };

            self.getDeviceInfo = function () {
                var p = new UAParser();
                return (p.getDevice().type || "Desktop") + " / " +
                 p.getOS().name + " / " + p.getBrowser().name;
            };

            self.init();
        }
    ]
);
