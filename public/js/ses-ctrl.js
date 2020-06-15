"use strict";

let adpp = angular.module("SesList", ["ui.bootstrap",'btford.socket-io', 'angular-intro']);

adpp.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

adpp.controller("SesListController", ["$scope", "$http", "$socket", "$uibModal", "ngIntroService", function ($scope, $http, $socket, $uibModal, ngIntroService) {
    let self = $scope;
    self.sessions = [];
    self.sesOpen = false;
    self.invCode = "";
    self.showCodeError = false;
    self.routes= {
        L: "to-visor",
        M: "to-semantic",
        S: "to-select",
        E: "to-differential",
        R: "to-role",
    };

    self.init = () => {
        self.updateSessions();
        $socket.on("stateChange", (data) => {
            console.log("SOCKET.IO", data);
            self.updateSessions();
        });
        self.showName();
    };

    self.showName = () => {
        $http.post("get-my-name").success((data) => {
            self.username = data.name;
            self.mylang = data.lang;
        });
    };

    self.updateSessions = () => {
        $http({url: "get-session-list", method: "post"}).success((data) => {
            self.sessions = data;
        });
    };

    self.openSes = () => {
        self.sesOpen = true;
    };

    self.enterCode = () => {
        if(self.checkCode(self.invCode.toLowerCase())) {
            let postdata = {code: self.invCode.toLowerCase()};
            $http.post("enter-session-code", postdata).success((data) => {
                if (data.status == "ok") {
                    window.location.replace(data.redirect);
                }
                else {
                    $uibModal.open({
                        template: '<div><div class="modal-header"><h4>Error</h4></div><div class="modal-body">' +
                            '<p>El código ingresado no es válido</p></div></div>'
                    });
                }
            });
        }
    };

    self.checkCode = (code) => {
        console.log(self.sessions, code);
        let s = self.sessions.find(e => e.code == code);
        console.log(s);
        if(s == null)
            return true;
        let url = self.routes[s.type]+ "?sesid=" + s.id;
        window.location.replace(url);
        return false;
    };

    self.changeLang = () => {
        let newlang = (self.mylang == "english") ? "spanish" : "english";
        $http.post("update-lang", {lang: newlang}).success((data) => {
            self.showName();
        });
    };

    let introOptions = {
        steps:[
            {
                element: '#seslistdiv',
                intro: 'Aqui debajo se muestran todas las sesiones que tienes disponibles. Al apretar en una de ellas puedes ingresar a la actividad',
                position: "right"
            },
            {
                element: "#codebox",
                intro: "Para ingresar a una nueva actividad, debes ingresar el código de una sesión que te entrega el/la profesor/a en este campo."
            },
            {
                element: "#codeboxbtn",
                intro: "Usando este botón ingresas a la sesión indicada por el código",
            },
            {
                element: '#changelang',
                intro: "Con este botón puedes cambiar el idioma. Using this button you can change the language",
                position: "left"
            },
            {
                element: '#topbtnlist',
                intro: 'Finalmente usando el botón de ayuda puedes volver a ver esta ayuda y con el botón de salir puedes cerrar sesión.',
                position: "left"
            }
        ],
        showStepNumbers: false,
        showBullets: false,
        exitOnOverlayClick: true,
        exitOnEsc: true,
        tooltipPosition: "auto",
        nextLabel: 'Siguiente',
        prevLabel: 'Anterior',
        skipLabel: 'Salir',
        doneLabel: 'Listo'
    };

    ngIntroService.setOptions(introOptions);

    self.startTour = () => {
        ngIntroService.start();
    };

    self.init();
}]);
