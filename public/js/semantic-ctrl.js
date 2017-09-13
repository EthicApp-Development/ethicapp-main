"use strict";

let app = angular.module("Semantic", ['ui.tree', 'btford.socket-io', "timer", "ui-notification"]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller("SemanticController", ["$scope", "$http", "$timeout", "$socket", "Notification", function ($scope, $http, $timeout, $socket, Notification) {
    let self = $scope;

    self.iteration = 1;
    self.sesStatusses = ["Individual", "Grupal", "Reporte", "Evaluación de Pares", "Finalizada"];

    self.documents = [];
    self.finished = false;

    self.text = "";
    self.sentences = [];
    self.highlight = [];

    self.units = [];


    self.init = () => {
        self.getSesInfo();
    };

    self.getSesInfo = () => {
        $http({url: "get-ses-info", method: "post"}).success((data) => {
            self.iteration = data.iteration;
            self.myUid = data.uid;
            self.sesName = data.name;
            self.sesId = data.id;
            self.sesDescr = data.descr;
            self.sesSTime = (data.stime != null) ? new Date(data.stime) : null;
            self.getDocuments();
            /*$http({url: "data/instructions.json", method: "get"}).success((data) => {
                self.instructions = data;
            });
            if (self.iteration == 3){
                self.getTeamInfo();
            }
            if(self.iteration >= 5){
                self.finished = true;
            }*/
            $http({url: "get-finished", method: "post", data: {status: self.iteration + 2}}).success((data) => {
                if (data.finished) {
                    self.finished = true;
                }
            });
        });
    };

    self.selectDocument = (idx) => {
        if(self.selectedDocument == idx) return;
        self.selectedDocument = idx;
        self.text = self.documents[idx].content;
        // -- ! IMPORTANT : No cambiar
        self.text = self.text.replace(/.[ ]+\n/,".\n");
        self.sentences = self.text.match(/[^.!?\n]+[.!?\n]+/g ) || [];
        // -- ! IMPORTANT
        self.highlight = Array.from(self.sentences.length, () => false);
    };

    self.countHightlight = () => {
        return self.highlight.reduce((val, elem) => (elem)? val + 1 : val, 0);
    };

    self.getDocuments = () => {
        $http({method: "post", url: "get-semantic-documents"}).success((data) => {
            self.documents = data;
            if(self.documents.length > 0) {
                self.selectDocument(0);
                self.getUnits();
            }
        });
    };

    self.getUnits = () => {
        $http({method: "post", url: "get-semantic-units"}).success((data) => {
            self.units = data;
            //self.addEmptyUnit();
        });
    };

    self.getHgSents = () => {
        return self.highlight.map((e,i) => { return {st: i, b: e}}).filter(e => e.b).map(e => e.st);
    };

    self.addSemUnit = (unit) => {
        let postdata = {
            comment: unit.comment,
            sentences: self.getHgSents(),
            docid: unit.docid
        };
        $http({method: "post", url: "add-semantic-unit", data:postdata}).success((data) => {
            self.getUnits(); //Update?
        });
    };

    self.addEmptyUnit = () => {
        self.units.push({
            comment: "",
            sentences: self.getHgSents(),
            status: "unsaved",
            docid: self.documents[self.selectedDocument].id
        });
    };

    self.finishState = () => {
        if(self.finished){
            return;
        }
        if(self.units.length - 1 < self.documents.length){
            Notification.error("No hay suficientes unidades semánticas para terminar la actividad");
            return;
        }
        if(!self.areAllUnitsSync()) {
            Notification.error("Hay unidades semánticas que no han sido enviadas");
            return;
        }
        let confirm = window.confirm("¿Esta seguro que desea terminar la actividad?\nEsto implica no volver a poder editar sus respuestas");
        if(confirm) {
            let postdata = {status: self.iteration + 2};
            $http({url: "record-finish", method: "post", data: postdata}).success((data) => {
                self.hasFinished = true;
                self.finished = true;
                console.log("FINISH");
            });
        }
    };

    self.areAllUnitsSync = () => {
        for(let i = 0; i < self.units.length; i++){
            let idea = self.units[i];
            if(idea.status == "unsaved" || idea.status == "dirty")
                return false;
        }
        return true;
    };

    self.init();

}]);
