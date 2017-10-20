"use strict";

let app = angular.module("Semantic", ['ui.tree', 'btford.socket-io', "timer", "ui-notification"]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller("SemanticController", ["$scope", "$http", "$timeout", "$socket", "Notification", function ($scope, $http, $timeout, $socket, Notification) {
    let self = $scope;

    self.iteration = 0;
    self.sesStatusses = [{i: 1, name: "Individual"}, {i: 3, name: "Grupal"}, {i: 4, name: "Reporte"},
        {i: 5, name: "Evaluación de Pares"}, {i: 6, name: "Finalizada"}];

    self.documents = [];
    self.finished = false;

    self.text = "";
    self.sentences = [];
    self.highlight = [];
    self.disabledSents = [];
    self.originalTexts = [];
    self.originalSentences = [];
    self.sent = {};
    self.writingReport = false;
    self.followLeader = false;
    self.leader = false;
    self.writingReport = false;

    self.views = {};

    self.units = [];
    self.unitsIter1 = [];
    self.unitsIter3 = [];

    self.shared = {};
    self.teamNames = {};

    self.editing = -1;
    self.hgDocs = {};


    self.init = () => {
        $socket.on("stateChange", (data) => {
            console.log("SOCKET.IO", data);
            if(data.ses == self.sesId){
                window.location.reload();
            }
        });
        $socket.on("updateTeam", (data) => {
            if(self.teamId == data.tmid){
                if(!self.leader) {
                    self.getUnits();
                }
                self.getTeamInfo();
            }
        });
        self.getSesInfo();
    };

    self.getSesInfo = () => {
        $http({url: "get-ses-info", method: "post"}).success((data) => {
            self.iteration = data.iteration;
            self.myUid = data.uid;
            self.sesName = data.name;
            self.sesId = data.id;
            self.sesDescr = (self.iteration < 4) ? (data.descr.split("\n")[0] || data.descr) : (data.descr.split("\n")[1] || data.descr);
            self.sesSTime = (data.stime != null) ? new Date(data.stime) : null;
            self.getDocuments();
            /*$http({url: "data/instructions.json", method: "get"}).success((data) => {
                self.instructions = data;
            });*/
            if (self.iteration == 3){
                self.getTeamInfo();
            }
            if(self.iteration >= 3){
                self.getSimpleTeamInfo();
            }
            if(self.iteration == 4){
                self.writingReport = true;
            }
            if(self.iteration >= 5){
                self.finished = true;
            }
            if(self.iteration == 6){
                window.location.replace("rubrica");
            }
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
        self.text = self.originalTexts[idx];
        self.sentences = self.originalSentences[idx];
    };

    self.countHighlight = () => {
        //console.log(self.highlight);
        return self.highlight != null &&
            self.highlight.reduce((a,b) => a.concat(b), []).reduce((val, elem) => (elem)? val + 1 : val, 0);
    };

    self.getDocuments = () => {
        $http({method: "post", url: "get-semantic-documents"}).success((data) => {
            self.documents = data;
            if(self.documents.length > 0) {
                self.processDocuments();
                self.selectDocument(0);
                self.getUnits();
            }
        });
    };

    self.processDocuments = () => {
        self.highlight = [];
        self.disabledSents = [];
        self.originalTexts = [];
        self.originalSentences = [];
        for(let i = 0; i < self.documents.length; i++){
            let text = self.documents[i].content;
            self.originalTexts.push(text.replace(/.[ ]+\n/,".\n"));
            self.originalSentences.push(self.originalTexts[i].match(/[^.!?\n]+[.!?\n]+/g ) || []);
            self.highlight.push(Array.from({length: self.originalSentences[i].length}, () => false));
            self.disabledSents.push(Array.from({length: self.originalSentences[i].length}, () => false));
        }
    };

    self.processUnits = () => {
        for(let i = 0; i < self.units.length; i++){
            for(let j=0; j < self.units[i].sentences.length; j++){
                let docid = self.units[i].docs[j];
                let stid = self.units[i].sentences[j];
                self.disabledSents[docid][stid] = true;
            }
        }
        console.table(self.disabledSents);
    };

    self.getUnits = () => {
        let url = (self.iteration == 3)? "get-team-sync-units" : "get-semantic-units";
        $http({method: "post", url: url, data: {iteration: self.iteration}}).success((data) => {
            self.units = data;
            self.processUnits();
        });
        if(self.iteration > 1){
            $http({method: "post", url: "get-team-semantic-units", data: {iteration: 1}}).success((data) => {
                self.unitsIter1 = data;
            });
        }
        if(self.iteration > 3){
            $http({method: "post", url: "get-team-sync-units", data: {iteration: 3}}).success((data) => {
                self.unitsIter3 = data;
            });
        }
    };

    self.getHgSents = () => {
        return self.highlight.map((a,i) => a.map((e,j) => [e,j]).filter(e => e[0]).map(e => e[1]))
            .reduce((v,e) => v.concat(e), []);
    };

    self.getHgDocs = () => {
        return self.highlight.map((a,i) => a.map((e,j) => [e,j]).filter(e => e[0]).map(e => i))
            .reduce((v,e) => v.concat(e), []);
    };

    self.addSemUnit = (unit) => {
        if(self.iteration == 3 && !self.leader) return;
        if(unit.edit){
            self.toggleEdit(-1,unit);
        }
        if(self.iteration == 3 && (unit.comment == null || unit.comment.length ==0)){
            Notification.error("Debe ingresar un comentario.")
            return;
        }
        let url = (self.iteration == 3)? "add-sync-semantic-unit" : "add-semantic-unit";
        if(unit.id != null)
            url = "update-semantic-unit";
        let postdata = {
            id: unit.id,
            comment: unit.comment,
            sentences: unit.sentences,
            docs: unit.docs,
            iteration: self.iteration,
            uidoriginal: self.originalLeader
        };
        console.log(postdata);
        $http({method: "post", url: url, data:postdata}).success((data) => {
            unit.dirty = false;
            if(unit.id == null)
                unit.id = data.id;
            self.sent[unit.id] = true;
            if(self.iteration == 3)
                self.updateSignal();
        });
    };

    self.updateSignal = () => {
        $http({url: "update-my-team", method:"post"}).success((data) => {
            console.log("Team updated");
        });
    };

    self.takeControl = () => {
        $http({url: "take-team-control", method: "post"}).success((data) => {
            console.log("Control given");
            self.updateSignal();
        });
    };

    self.addEmptyUnit = () => {
        if(self.editing != -1){
            Notification.error("Debe terminar de editar la unidad actual para editar otra.");
            return;
        }
        self.units.push({
            id: null,
            comment: "",
            sentences: self.getHgSents(),
            status: "unsaved",
            docs: self.getHgDocs()
        });
        //console.log(self.units);
        let i = self.units.length -1;
        self.toggleEdit(i, self.units[i]);
    };

    self.finishState = () => {
        if(self.finished){
            return;
        }
        if(self.iteration <= 3) {
            if (self.units.length == 0) {
                Notification.error("No hay suficientes unidades semánticas para terminar la actividad");
                return;
            }
            if (!self.areAllUnitsSync()) {
                Notification.error("Hay unidades semánticas que no han sido enviadas");
                return;
            }
        }
        if(self.iteration == 4){
            self.shared.sendReport();
        }
        let confirm = window.confirm("¿Esta seguro que desea terminar la actividad?\nEsto implica no volver a poder editar sus respuestas");
        if(confirm) {
            let postdata = {status: self.iteration + 2};
            $http({url: "record-finish", method: "post", data: postdata}).success((data) => {
                self.hasFinished = true;
                self.finished = true;
                console.log("FINISH");
                if(self.iteration == 3)
                    self.updateSignal();
            });
        }
    };

    self.areAllUnitsSync = () => {
        return self.units.every(e => !e.dirty);
    };

    self.toggleEdit = (idx, unit) => {
        if(self.iteration == 3 && !self.leader) return;
        if(self.editing != -1 && !unit.edit){
            Notification.error("Debe terminar de editar la unidad actual para editar otra.");
            return;
        }
        if(unit.edit && self.countHighlight() == 0){
            Notification.error("Debe seleccionar al menos una unidad semántica");
            return;
        }
        if(!unit.edit) {
            //self.selectDocument(indexById(self.documents, unit.docid));
            unit.edit = true;
            self.editing = idx;
            self.fillHighlightByUnit(unit);
            self.fillUnitDisabled(unit, false);
            unit.dirty = true;
        }
        else{
            unit.sentences = self.getHgSents();
            unit.docs = self.getHgDocs();
            self.fillUnitDisabled(unit, true);
            unit.edit = false;
            self.editing = -1;
            self.unselectAllHighlights();
        }
    };

    self.fillUnitDisabled = (unit, val) => {
        for(let j=0; j < unit.sentences.length; j++){
            let docid = unit.docs[j];
            let stid = unit.sentences[j];
            self.disabledSents[docid][stid] = val;
        }
    };

    self.startView = (unit) => {
        // console.log("Start viewing: ", unit.id);
        if(unit.viewing){
            self.stopView(unit);
            return;
        }
        unit.viewing = true;
        self.views = {};
        unit.sentences.filter((e,i) => unit.docs[i] == self.selectedDocument).forEach(e => {
            self.views[e] = true;
        });
    };

    self.stopView = (unit) => {
        // console.log("Stop viewing: ", unit.id);
        unit.viewing = false;
        self.views = {};
    };

    self.fillHighlightByUnit = (unit) => {
        self.unselectAllHighlights();
        // console.log(unit);
        self.hgDocs = {};
        let first = true;
        for(let i = 0; i < unit.sentences.length; i++){
            let doc = unit.docs[i];
            self.hgDocs[doc] = true;
            if(first) {
                self.selectDocument(doc);
                first = false;
            }
            let st = unit.sentences[i];
            self.highlight[doc][st] = true;
        }
        // console.log(self.highlight);
    };

    self.unselectAllHighlights = () => {
        self.hgDocs = {};
        for(let i = 0; i < self.highlight.length; i++){
            for(let j = 0; j < self.highlight[i].length; j++){
                self.highlight[i][j] = false;
            }
        }
    };

    self.getTeamInfo = () => {
        $http({url: "get-team-leader", method: "post"}).success((data) => {
            self.teamId = data.id;
            self.originalLeader = data.original_leader;
            if(data.leader == self.myUid){
                self.leader = true;
                self.followLeader = false;
            }
            else{
                self.leader = false;
                self.followLeader = true;
            }
        });
        $http({url: "get-team", method: "post"}).success((data) => {
            self.teamstr = data.map(e => e.name + ((e.finished)? " ✓" : "")).join(", ");
        });
    };

    self.getSimpleTeamInfo = () => {
        $http({url: "get-team", method: "post"}).success((data) => {
            self.teamNames = {};
            data.forEach(u => {
                self.teamNames[u.id] = u.name;
            });
        });
    };

    self.deleteUnit = (idx, unit) => {
        if(unit.edit){
            Notification.error("No puede eliminar una unidad que está siendo editada");
            return;
        }
        if(unit.id != null){
            let postdata = {id: unit.id};
            $http({url: "delete-semantic-unit", method: "post", data: postdata}).success((data) => {
                console.log("Idea deleted");
                if(self.iteration == 3)
                    self.updateSignal();
            });
        }
        self.units.splice(idx,1);
    };

    self.init();

}]);

app.controller("ReportController", ["$scope", "$http", function ($scope, $http) {
    let self = $scope;
    self.isFull = true;
    self.content = "";
    self.lastSent = null;

    self.toggleFull = () => {
        self.isFull = !self.isFull;
    };

    self.sendReport = () => {
        let postdata = {content: self.content};
        $http({url:"send-report", method:"post", data:postdata}).success((data) => {
            if (data.status == "ok"){
                self.lastSent = new Date();
                //self.shared.sendReportIdeas();
            }
        });
    };

    self.shared.sendReport = self.sendReport;

    self.getReport = () => {
        $http({url:"get-my-report", method:"post"}).success((data) => {
            if (data.status == "ok"){
                self.content = data.content;
                self.idReport = data.id;
                //self.shared.getReportIdeas();
            }
        });
    };

    self.getReport();

}]);

let indexById = (arr, id) => {
    return arr.findIndex(e => e.id == id);
};