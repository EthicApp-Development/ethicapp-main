"use strict";

let app = angular.module("Select", ["ui.bootstrap", "timer", 'btford.socket-io', "ui-notification", "ngSanitize", "ngMap"]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller("SelectController", ["$scope", "$http", "$socket", "Notification", "$uibModal", "NgMap", function ($scope, $http, $socket, Notification, $uibModal, NgMap) {
    let self = $scope;

    self.selectedQs = 0;
    self.iteration = 1;
    self.myUid = -1;
    self.questions = [];
    self.otherAnswsers = {};
    self.answers = {};
    self.anskey = {};
    self.comments = {};
    self.confidences = {};
    self.optLabels = ["A", "B", "C", "D", "E"];
    self.optConfidence = [0, 25, 50, 75, 100];
    self.sent = {};
    self.teamUids = [];
    self.bottomMsg = "";
    self.finished = false;
    self.useConfidence = false;
    self.shared = {};

    self.ansIter1 = {};
    self.ansIter2 = {};

    self.sesStatusses = ["Individual", "Anónimo", "Grupal", "Finalizada"];

    self.init = () => {
        self.getSesInfo();
        $socket.on("stateChange", (data) => {
            console.log("SOCKET.IO", data);
            if (data.ses == self.sesId) {
                window.location.reload();
            }
        });
        $socket.on("teamProgress", (data) => {
            console.log("SOCKET.IO", data);
            if (data.ses == self.sesId && data.tmid == self.teamId && self.iteration == 3) {
                self.updateTeam();
            }
        });
        $socket.on("updateOverlay", (data) => {
            console.log("SOCKET.IO", data);
            if(data.qid == self.questions[self.selectedQs].id && self.iteration == 3){
                self.shared.updateOverlayList();
            }
        });
        NgMap.getMap().then((map) => {
            self.map = map;
        });
    };

    self.getSesInfo = () => {
        $http({url: "get-ses-info", method: "post"}).success((data) => {
            self.iteration = data.iteration + 1;
            self.myUid = data.uid;
            self.sesName = data.name;
            self.sesId = data.id;
            self.sesSTime = data.stime;
            self.sesDescr = data.descr;
            self.useConfidence = (data.options != null && data.options.includes("C"));
            let set = new Set();
            if (self.iteration > 1) {
                $http({url: "get-team-selection", method: "post", data: {iteration: 1}}).success((data) => {
                    data.forEach((ans) => {
                        self.ansIter1[ans.qid] = self.ansIter1[ans.qid] || {};
                        self.ansIter1[ans.qid][ans.uid] = {answer: ans.answer, comment: ans.comment};
                        set.add(ans.uid);
                    });
                    self.teamUids = Array.from(set);
                    self.shared.updateOverlayList();
                });
            }
            if (self.iteration > 2) {
                $http({url: "get-team-selection", method: "post", data: {iteration: 2}}).success((data) => {
                    data.forEach((ans) => {
                        self.ansIter2[ans.qid] = self.ansIter2[ans.qid] || {};
                        self.ansIter2[ans.qid][ans.uid] = {answer: ans.answer, comment: ans.comment};
                        set.add(ans.uid);
                    });
                    self.teamUids = Array.from(set);
                });
                self.updateTeam();
                self.shared.updateOverlayList();
            }
            if (self.iteration >= 4) {
                self.finished = true;
                self.loadAnskey();
            }
            self.loadQuestions();
            self.loadAnswers();
        });
    };

    self.updateTeam = () => {
        $http({url: "get-team", method: "post"}).success((data) => {
            self.team = {};
            self.teamstr = data.map(e => e.name).join(", ");
            data.forEach((tm) => {
                self.team[tm.id] = tm.name;
            });
            if (data.length > 0) {
                self.teamId = data[0].tmid;
                self.teamProgress = data[0].progress;
                if (self.iteration == 3)
                    self.selectQuestion(self.teamProgress);
            }
        });
    };

    self.loadQuestions = () => {
        $http({url: "get-questions", method: "post"}).success((data) => {
            self.questions = data;
            self.questions.forEach((qs) => {
                qs.options = qs.options.split("\n");
                qs.map = processMap(qs);
            });
            self.shared.updateOverlayList();
        });
    };

    let processMap = (qs) => {
        const MAP_SCRIPT = '<pre class="ql-syntax" spellcheck="false">MAP ';
        let ini = qs.content.indexOf(MAP_SCRIPT);
        let end = qs.content.indexOf("</pre>");
        if(ini != -1 && end != -1 && ini < end){
            let comps = qs.content.substring(ini + MAP_SCRIPT.length, end-1).split(" ");
            qs.content = qs.content.substring(0,ini) + qs.content.substring(end+6);
            //console.log(qs.content);
            qs.content = qs.content.replace(/<p><br><\/p>/g, "");
            return {
                center: "[" + comps[0] + ", " + comps[1]  + "]",
                zoom: comps[2],
                nav: comps[3] == "NAV",
                edit: comps[3] == "EDIT" || comps[4] == "EDIT"
            }
        }
        return null;
    };

    self.loadAnskey = () => {
        $http({url: "get-anskey", method: "post"}).success((data) => {
            self.anskey = {};
            data.forEach((qs) => {
                self.anskey[qs.id] = qs;
            });
        });
    };

    self.loadAnswers = () => {
        $http({url: "get-answers", method: "post", data: {iteration: Math.min(3, self.iteration)}}).success((data) => {
            data.forEach((ans) => {
                self.answers[ans.qid] = ans.answer;
                self.comments[ans.qid] = ans.comment;
                self.confidences[ans.qid] = ans.confidence;
                self.sent[ans.qid] = true;
            });
        });
    };

    self.setAnswer = (qs, ans) => {
        self.answers[qs.id] = ans;
        qs.dirty = true;
    };

    self.selectQuestion = (idx) => {
        self.selectedQs = idx;
        self.shared.updateOverlayList();
    };

    self.nextQuestion = () => {
        if (self.iteration == 3) {
            console.log("Checking team answers");
            let postdata = {qid: self.questions[self.selectedQs].id};
            $http({url: "check-team-answer", method: "post", data: postdata}).success((data) => {
                if (data.status == "ok") {
                    self.sendTeamProgress(self.selectedQs + 1);
                    self.bottomMsg = "";
                }
                else if (data.status == "incomplete") {
                    self.bottomMsg = "Debe esperar a que todos los miembros del equipo respondan";
                }
                else if (data.status == "different") {
                    self.bottomMsg = "Las respuestas de los miembros del equipo no coinciden";
                }
                else if (data.status == "incorrect" && !self.questions[self.selectedQs].hinted) {
                    self.bottomMsg = "Comentario: " + data.msg;
                    self.questions[self.selectedQs].hinted = true;
                }
                else if (self.questions[self.selectedQs].hinted) {
                    self.sendTeamProgress(self.selectedQs + 1);
                    self.bottomMsg = "";
                }
                else {
                    Notification.info("Se alcanzo el final de la actividad");
                }
            });
        }
        else if (self.questions[self.selectedQs].dirty) {
            Notification.error("No se ha enviado una respuesta a la pregunta");
        }
        else if (self.selectedQs >= self.questions.length - 1 && self.iteration != 3) {
            Notification.info("Se alcanzo el final de la actividad");
        }
        else {
            self.selectQuestion(self.selectedQs + 1);
        }
    };

    self.sendTeamProgress = (pg) => {
        let postdata = {tmid: self.teamId, progress: pg};
        $http({url: "send-team-progress", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok")
                console.log("Progress sent");
        });
    };

    self.prevQuestion = () => {
        if (self.selectedQs <= 0) {
            Notification.info("Se alcanzo el inicio de la actividad");
            return;
        }
        if (self.questions[self.selectedQs].dirty) {
            Notification.error("No se ha enviado una respuesta a la pregunta");
        }
        else if (self.iteration != 3) {
            self.selectQuestion(self.selectedQs - 1);
        }
    };

    self.sendAnswer = (qs) => {
        if (self.answers[qs.id] == null || self.answers[qs.id] == -1) {
            Notification.error("Debe seleccionar una alternativa");
            return;
        }
        if (self.comments[qs.id] == null || self.comments[qs.id] == "") {
            Notification.error("Debe agregar un comentario");
            return;
        }
        let postdata = {
            qid: qs.id,
            answer: self.answers[qs.id],
            comment: self.comments[qs.id],
            confidence: self.confidences[qs.id],
            iteration: self.iteration
        };
        $http({url: "send-answer", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                self.sent[postdata.qid] = true;
                qs.dirty = false;
            }
        });
    };

    self.showInfo = () => {
        $uibModal.open({
            template: '<div><div class="modal-header"><h4>Factor Detonante</h4></div><div class="modal-body"><p>' +
            self.sesDescr + '</p></div></div>'
        });
    };

    self.init();

}]);

app.controller("GeoController", ["$scope", "$http", "NgMap", "$socket", function ($scope, $http, NgMap, $socket) {

    let self = $scope;

    self.openRight = false;
    self.rightTab = "";

    self.mOverlays = [];
    self.sOverlays = [];

    self.selectedOverlay = null;
    self.editing = false;

    let requestIndex = 0;

    let init = () => {
        //self.updateOverlayList();
        self.clearOverlay();
        NgMap.getMap().then((map) => {
            console.log("MAP cargado correctamente");
            self.map = map;
            self.map.streetView.setOptions({addressControlOptions: {position: google.maps.ControlPosition.TOP_CENTER}});
            self.shared.updateOverlayList();
        });
        $socket.on("update-overlay", (data) => {
            if(data.sesid == self.sesId){
                self.updateOverlayList();
            }
        });
    };

    let toOverlay = (col) => {
        return (data) => {
            return {
                id: data.id,
                name: data.name,
                description: data.description + "\n" + buildFooter(data),
                color: col,
                type: data.type,
                fullType: getFullType(data.type),
                geom: JSON.parse(data.geom)
            };
        };
    };

    let getColor = (data) => {
        return (data.iteration == 0) ? "blue" : "red";
    };

    let buildFooter = (data) => {
        if(data.iteration == 0)
            return "Predefinido";
        if(data.uid == self.myUid)
            return self.sesStatusses[data.iteration-1] + " - Propio";
        return self.sesStatusses[data.iteration-1] + " - " + (self.team[data.uid] ? self.team[data.uid] : ("Anonimo " + data.uid));
    };

    let packOverlay = (overlay) => {
        return {
            name: overlay.name,
            description: overlay.description,
            iteration: self.iteration,
            qid: (self.questions[self.selectedQs] != null) ? self.questions[self.selectedQs].id : -1,
            type: overlay.type,
            geom: JSON.stringify(overlay.geom)
        };
    };

    let getFullType = (t) => {
        switch (t){
            case "M":
                return "marker";
            case "P":
                return "polygon";
            case "L":
                return "polyline";
            case "R":
                return "rectangle";
            case "C":
                return "circle";
            case "I":
                return "image";
        }
    };

    self.clearOverlay = () => {
        self.newOverlay = {
            name: "",
            description: "",
            color: "red",
            type: "M",
            fullType: "marker",
            geom: {
                position: null,
                radius: null,
                center: null,
                path: null,
                bounds: null
            }
        };
    };

    self.updateOverlayList = () => {
        let ri = requestIndex + 1;
        self.mOverlays = [];
        self.sOverlays = [];
        if(self.iteration == 2 && angular.equals(self.teamUids, []) || self.iteration >= 3 && (self.team == null || angular.equals(self.team, {})))
            return;

        let qid = (self.questions[self.selectedQs] != null) ? self.questions[self.selectedQs].id : -1;

        // Default Data
        $http.post("list-default-overlay", {qid: qid}).success((data) => {
            if(requestIndex > ri) return;
            let overlays = data.map(toOverlay("blue"));
            self.mOverlays = self.mOverlays.concat(overlays.filter(e => e.type == "M"));
            self.sOverlays = self.sOverlays.concat(overlays.filter(e => e.type != "M"));
        });

        // Personal Data
        let postdata = {
            qid: qid,
            iteration: self.iteration
        };
        $http.post("list-overlay", postdata).success((data) => {
            if(requestIndex > ri) return;
            let overlays = data.map(toOverlay("red"));
            self.mOverlays = self.mOverlays.concat(overlays.filter(e => e.type == "M"));
            self.sOverlays = self.sOverlays.concat(overlays.filter(e => e.type != "M"));
        });

        const colors = ["green", "orange", "violet", "grey"];

        // Anonimous Data
        if(self.iteration == 2){
            self.teamUids.forEach((uid,i) => {
                if(uid == self.myUid)
                    return;
                let udata = {qid: qid, iteration: 1, uid: uid};
                $http.post("list-team-overlay", udata).success((data) => {
                    if(requestIndex > ri) return;
                    let overlays = data.map(toOverlay(colors[i%4]));
                    self.mOverlays = self.mOverlays.concat(overlays.filter(e => e.type == "M"));
                    self.sOverlays = self.sOverlays.concat(overlays.filter(e => e.type != "M"));
                });
            });
        }

        // Groupal Data
        if(self.iteration >= 3){
            self.teamUids.forEach((uid,i) => {
                if(uid == self.myUid)
                    return;
                let udata = {qid: qid, iteration: 3, uid: uid};
                $http.post("list-team-overlay", udata).success((data) => {
                    if(requestIndex > ri) return;
                    let overlays = data.map(toOverlay(colors[i%4]));
                    self.mOverlays = self.mOverlays.concat(overlays.filter(e => e.type == "M"));
                    self.sOverlays = self.sOverlays.concat(overlays.filter(e => e.type != "M"));
                });
            });
        }

    };

    self.shared.updateOverlayList = () => {
        if(self.map != null){
            google.maps.event.trigger(self.map, "resize");
            self.map.infoWindows.iw.close();
            self.updateOverlayList();
        }
    };

    self.onMapOverlayCompleted = (ev) => {
        self.editing = true;
        self.map.mapDrawingManager[0].setDrawingMode(null);

        self.newOverlay.fullType = ev.type;
        self.newOverlay.type = (ev.type == "polyline") ? "L" : ev.type[0].toUpperCase();
        self.newOverlay.geom.position = ev.overlay.getPosition ? positionToArray(ev.overlay.getPosition()) : null;
        self.newOverlay.geom.radius = ev.overlay.radius;
        self.newOverlay.geom.center = positionToArray(ev.overlay.center);
        self.newOverlay.geom.path = ev.overlay.getPath ? mutiplePositionToArray(ev.overlay.getPath()) : null;
        self.newOverlay.geom.bounds = ev.overlay.getBounds ? boundsToArray(ev.overlay.getBounds()) : null;

        self.newOverlay.centroid = centroidAsLatLng(self.newOverlay.type, self.newOverlay.geom);
        self.map.showInfoWindow("iw2");

        ev.overlay.setMap(null);
    };

    self.colorizeShape = (col) => {
        if(self.map.shapes && self.map.shapes.nshp) {
            self.map.shapes.nshp.set("fillColor", col);
            self.map.shapes.nshp.set("strokeColor", "dark"+col);
        }
    };

    self.closeOverlay = () => {
        self.clearOverlay();
        self.map.infoWindows.iw2.close();
    };

    let updateOverlay =  () => {
        let ov = (self.newOverlay.type == "M")? self.map.markers.nmkr : self.map.shapes.nshp;
        self.newOverlay.geom.position = ov.getPosition ? positionToArray(ov.getPosition()) : null;
        self.newOverlay.geom.radius = ov.radius;
        self.newOverlay.geom.center = positionToArray(ov.center);
        self.newOverlay.geom.path = ov.getPath ? mutiplePositionToArray(ov.getPath()) : null;
        self.newOverlay.geom.bounds = ov.getBounds ? boundsToArray(ov.getBounds()) : null;
        self.newOverlay.centroid = centroidAsLatLng(self.newOverlay.type, self.newOverlay.geom);
        self.map.showInfoWindow("iw2");
    };

    self.sendOverlay = () => {
        updateOverlay();
        $http.post("add-overlay", packOverlay(self.newOverlay)).success((data) => {
            if(data.status == "ok"){
                self.closeOverlay();
                self.updateOverlayList();
            }
        });
    };

    self.clickOverlay = function(event){
        self.selectOverlay(this.id);
    };

    self.selectOverlay = (id) => {
        self.selectedOverlay = self.mOverlays.find(e => e.id == id) || self.sOverlays.find(e => e.id == id);
        self.selectedOverlay.centroid = centroidAsLatLng(self.selectedOverlay.type, self.selectedOverlay.geom);
        self.map.panTo(self.selectedOverlay.centroid);
        self.map.showInfoWindow("iw");
    };

    self.googleSearch = function(){
        let p = this.getPlace();
        if(p == null || p.geometry == null || p.geometry.location == null)
            return;

        self.map.mapDrawingManager[0].setDrawingMode(null);
        self.newOverlay.fullType = "marker";
        self.newOverlay.type = "M";
        self.newOverlay.geom.position = positionToArray(p.geometry.location);

        self.map.panTo(p.geometry.location);
    };


    init();

}]);

app.filter("trustHtml", ["$sce", function($sce){
    return function(html){
        return $sce.trustAsHtml(html)
    };
}]);

let positionToArray = (pos) => {
    if (pos == null)
        return null;
    return [pos.lat(), pos.lng()];
};

let mutiplePositionToArray = (mpos) => {
    let r = [];
    for (let i = 0; i < mpos.getLength(); i++) {
        let pos = mpos.getAt(i);
        r.push(positionToArray(pos));
    }
    return r;
};

let boundsToArray = (bounds) => {
    return [positionToArray(bounds.getSouthWest()), positionToArray(bounds.getNorthEast())];
};

let avgCoord = (arr) => {
    let slat = 0;
    let slng = 0;
    for (let i = 0; i < arr.length; i++) {
        slat += arr[i][0];
        slng += arr[i][1];
    }
    return [slat/arr.length, slng/arr.length];
};

let centroidAsLatLng = (type, geom) => {
    let c = centroid(type, geom);
    return new google.maps.LatLng(c[0], c[1]);
};

let centroid = (type, geom) => {
    if(type == "M")
        return geom.position;
    if(type == "C")
        return geom.center;
    if(type == "R")
        return avgCoord(geom.bounds);
    if(type == "P" || type == "L")
        return avgCoord(geom.path);
    return null;
};