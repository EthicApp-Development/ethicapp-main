"use strict";

let adpp = angular.module("Admin", ["ui.bootstrap", "ui.multiselect", "nvd3", "timer", "ui-notification"]);

const DASHBOARD_AUTOREALOD = true;
const DASHBOARD_AUTOREALOD_TIME = 15;

adpp.controller("AdminController", function ($scope, $http, $uibModal, $location, $locale) {
    let self = $scope;

    $locale.NUMBER_FORMATS.GROUP_SEP = '';
    self.shared = {};
    self.sessions = [];

    self.selectedSes = null;
    self.documents = [];
    self.questions = [];
    self.questionTexts = [];
    self.newUsers = [];
    self.users = {};
    self.selectedIndex = -1;
    self.sesStatusses = ["No Publicada", "Lectura", "Personal", "Anónimo", "Grupal", "Finalizada"];
    self.optConfidence = [0, 25, 50, 75, 100];
    self.iterationNames = [];
    self.openSidebar = true;

    self.init = () => {
        self.shared.updateSesData();
    };

    self.selectSession = (idx) => {
        self.selectedIndex = idx;
        self.selectedSes = self.sessions[idx];
        self.requestDocuments();
        self.requestSemDocuments();
        self.requestQuestions();
        self.getNewUsers();
        self.getMembers();
        self.shared.verifyGroups();
        self.shared.resetGraphs();
        self.shared.verifyTabs();
        self.shared.resetTab();
        $location.path(self.selectedSes.id);
    };

    self.shared.updateSesData = () => {
        $http({url: "get-session-list", method: "post"}).success((data) => {
            console.log("Session data updated");
            self.sessions = data;
            if (self.selectedIndex != -1)
                self.selectSession(self.selectedIndex);
            else {
                self.sesFromURL();
            }
        });
    };

    self.sesFromURL = () => {
        let sesid = +($location.path().substring(1));
        let sidx = self.sessions.findIndex(e => e.id == sesid);
        if (sidx != -1)
            self.selectSession(sidx);
    };

    self.requestDocuments = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "documents-session", method: "post", data: postdata}).success((data) => {
            self.documents = data;
        });
    };

    self.shared.updateDocuments = self.requestDocuments;

    self.deleteDocument = (docid) => {
        let postdata = {docid: docid};
        $http({url: "delete-document", method: "post", data: postdata}).success((data) => {
            self.requestDocuments();
        });
    };

    self.requestQuestions = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "questions-session", method: "post", data: postdata}).success((data) => {
            self.questions = data.map(e => {
                e.options = e.options.split("\n");
                return e;
            });
        });
        $http({url: "get-question-text", method: "post", data: postdata}).success((data) => {
            self.questionTexts = data;
        });

    };

    self.requestSemDocuments = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "semantic-documents", method: "post", data: postdata}).success((data) => {
            self.semDocs = data;
        });
    };

    self.getNewUsers = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "get-new-users", method: "post", data: postdata}).success((data) => {
            self.newUsers = data;
        });
    };

    self.getMembers = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "get-ses-users", method: "post", data: postdata}).success((data) => {
            self.usersArr = data;
            self.users = {};
            data.forEach((d) => {
                self.users[d.id] = d;
            });
        });
    };

    self.openNewSes = () => {
        $uibModal.open({
            templateUrl: "templ/new-ses.html"
        });
    };

    self.openDuplicateSes = () => {
        if(self.selectedSes == null) return;
        let ses = angular.copy(self.selectedSes);
        $uibModal.open({
            templateUrl: "templ/duplicate-ses.html",
            controller: "DuplicateSesModalController",
            controllerAs: "vm",
            scope: self,
            resolve: {
                data: function () {
                    return ses;
                },
            }
        });
    };

    self.toggleSidebar = () => {
        self.openSidebar = !self.openSidebar;
        self.shared.updateState()
    };

    self.init();
});

adpp.controller("TabsController", function ($scope, $http) {
    let self = $scope;
    self.tabOptions = ["Descripción", "Dashboard"];
    self.tabConfig = ["Usuarios", "Grupos"];
    self.selectedTab = 0;
    self.selectedTabConfig = -1;

    self.shared.resetTab = () => {
        self.selectedTab = 0;
        if (self.selectedSes != null && self.selectedSes.status > 1) {
            self.selectedTab = 1;
        }
        self.selectedTabConfig = -1;
        if (self.selectedSes.status == 7) {
            self.shared.gotoRubrica();
        }
    };

    self.shared.verifyTabs = () => {
        if (self.selectedSes.type == "L") {
            self.iterationNames = [{name: "Lectura", val: 0}, {name: "Individual", val: 1},
                {name: "Grupal anónimo", val: 2}, {name: "Grupal", val: 3}, {name: "Reporte", val: 4},
                {name: "Calibración Rubrica", val: 5}, {name: "Evaluación de Pares", val: 6}];
            self.tabOptions = ["Configuración", "Dashboard"];
            self.tabConfig = ["Usuarios", "Grupos", "Rúbrica"];
            self.sesStatusses = ["Configuración", "Lectura", "Individual", "Anónimo", "Grupal", "Reporte", "Rubrica Calibración", "Evaluación de Pares", "Finalizada"];
            self.shared.getRubrica();
            self.shared.getExampleReports();
            self.shared.getReports();
        }
        else if(self.selectedSes.type == "S"){
            self.iterationNames = [{name: "Individual", val: 1}, {name: "Grupal anónimo", val: 2},
                {name: "Grupal", val: 3}];
            self.tabOptions = ["Configuración", "Dashboard"];
            self.tabConfig = ["Usuarios","Grupos",null,"Opciones"];
            self.sesStatusses = ["Configuración", "Individual", "Anónimo", "Grupal", "Finalizada"];
        }
        else if(self.selectedSes.type == "M"){
            self.iterationNames = [{name: "Individual", val: 1}, {name: "Grupal", val: 3}, {name: "Reporte", val:4}, {name: "Evaluación de Pares", val: 6}];
            self.tabOptions = ["Configuración", "Dashboard"];
            self.tabConfig = ["Usuarios", "Grupos","Rúbrica"];
            self.sesStatusses = [{i:-1, name: "Configuración"}, {i: 1, name: "Individual"}, {i: 3, name: "Grupal"}, {i: 4, name: "Reporte"},
                {i: 6, name: "Evaluación de Pares"}, {i: 7, name: "Finalizada"}];
            self.shared.getRubrica();
            self.shared.getExampleReports();
            self.shared.getReports();
        }
        if (self.selectedSes.status > 1) {
            self.selectedTab = 1;
        }
    };

    self.setTab = (idx) => {
        self.selectedTab = idx;
    };

    self.setTabConfig = (idx) => {
        self.selectedTabConfig = idx;
    };

    self.shared.gotoGrupos = () => {
        self.selectedTab = 0;
        self.selectedTabConfig = 1;
    };

    self.shared.gotoRubrica = () => {
        self.selectedTab = 0;
        self.selectedTabConfig = 2;
    };

});

adpp.controller("DocumentsController", function ($scope, $http, Notification, $timeout) {
    let self = $scope;

    self.busy = false;

    self.uploadDocument = (event) => {
        self.busy = true;
        let fd = new FormData(event.target);
        $http.post("upload-file", fd, {
            transformRequest: angular.identity,
            headers: {'Content-Type': undefined}
        }).success((data) => {
            if (data.status == "ok") {
                $timeout(() => {
                    Notification.success("Documento cargado correctamente");
                    event.target.reset();
                    self.busy = false;
                    self.shared.updateDocuments();
                }, 2000);
            }
        });
    };

});

adpp.controller("SesEditorController", function ($scope, $http, Notification) {
    let self = $scope;

    self.mTransition = {1: 3, 3: 5, 5: 6, 6: 8, 8: 9};

    self.splitDescr = false;
    self.splDes1 = "";
    self.splDes2 = "";

    self.toggleSplit = () => {
        self.splitDescr = !self.splitDescr;
        if(self.splitDescr){
            self.splDes1 = self.selectedSes.descr.split("\n")[0];
            self.splDes2 = self.selectedSes.descr.split("\n")[1] || "";
        }
        else{
            self.selectedSes.descr = self.splDes1 + "\n" + self.splDes2;
        }
    };

    self.updateSession = () => {
        if(splitDescr){
            self.selectedSes.descr = self.splDes1 + "\n" + self.splDes2;
        }
        if (self.selectedSes.name.length < 3 || self.selectedSes.descr.length < 5) {
            Notification.error("Datos de la sesión incorrectos o incompletos");
            return;
        }
        let postdata = {name: self.selectedSes.name, descr: self.selectedSes.descr, id: self.selectedSes.id};
        $http({url: "update-session", method: "post", data: postdata}).success((data) => {
            console.log("Session updated");
        });
    };

    self.shared.changeState = () => {
        if (self.selectedSes.type != "M" && self.selectedSes.status >= self.sesStatusses.length) {
            Notification.error("La sesión está finalizada");
            return;
        }
        if (self.selectedSes.type == "M" && self.selectedSes.status >= 9) {
            Notification.error("La sesión está finalizada");
            return;
        }
        if (self.selectedSes.type == "L" && self.selectedSes.status >= 3 && !self.selectedSes.grouped
            || self.selectedSes.type == "M" && self.selectedSes.status >= 3 && !self.selectedSes.grouped
            || self.selectedSes.type == "S" && self.selectedSes.status >= 2 && !self.selectedSes.grouped) {
            self.shared.gotoGrupos();
            Notification.error("Los grupos no han sido generados");
            return;
        }
        if (self.selectedSes.type == "L" && self.selectedSes.status >= 7 && !self.selectedSes.paired
            || self.selectedSes.type == "M" && self.selectedSes.status >= 6 && !self.selectedSes.paired) {
            self.shared.gotoRubrica();
            Notification.error("Los pares para la evaluación de pares no han sido asignados");
            return;
        }
        let confirm = window.confirm("¿Esta seguro que quiere ir al siguiente estado?");
        if (confirm) {
            if(self.selectedSes.type == "M"){
                let postdata = {sesid: self.selectedSes.id, state: self.mTransition[self.selectedSes.status] || self.selectedSes.status};
                $http({url: "force-state-session", method: "post", data: postdata}).success((data) => {
                    self.shared.updateSesData();
                });
            }
            else {
                let postdata = {sesid: self.selectedSes.id};
                $http({url: "change-state-session", method: "post", data: postdata}).success((data) => {
                    self.shared.updateSesData();
                });
            }
        }
    };

});

adpp.controller("NewUsersController", function ($scope, $http, Notification) {
    let self = $scope;
    let newMembs = [];

    self.addToSession = () => {
        if (self.newMembs.length == 0) {
            Notification.error("No hay usuarios seleccionados para agregar");
            return;
        }
        let postdata = {
            users: self.newMembs.map(e => e.id),
            sesid: self.selectedSes.id
        };
        $http({url: "add-ses-users", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                self.getNewUsers();
                self.getMembers();
            }
        });
    };

    self.removeUser = (uid) => {
        if (self.selectedSes.status == 1) {
            let postdata = {uid: uid, sesid: self.selectedSes.id};
            $http({url: "delete-ses-user", method: "post", data: postdata}).success((data) => {
                if (data.status == "ok") {
                    self.getNewUsers();
                    self.getMembers();
                }
            });
        }
    };

});

adpp.controller("SemDocController", function ($scope, $http, Notification) {
    let self = $scope;

    self.newSDoc = {id:null, title: "", content: ""};

    self.addSemDoc = () => {
        let postdata = {sesid: self.selectedSes.id, title: self.newSDoc.title, content: self.newSDoc.content};
        $http({url: "add-semantic-document", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                self.requestSemDocuments();
                Notification.success("Texto agregado correctamente");
                self.newSDoc = {id:null, title: "", content: ""};
            }
        });
    };

    self.deleteText = (id) => {
        let postdata = {id: id};
        $http.post("delete-semantic-document", postdata).success((data) => {
            if(data.status == "ok"){
                self.requestSemDocuments();
                Notification.success("Texto eliminado correctamente");
            }
        });
    };

    self.startEditText = (tx) => {
        self.newSDoc = {id:tx.id, title: tx.title, content: tx.content};
        Notification.info("Edite el texto en el formulario");
    };

    self.updateSemDoc = () => {
        if(self.newSDoc.id == null){
            Notification.error("No hay texto a editar.");
            return;
        }
        let postdata = {id: self.newSDoc.id, sesid: self.selectedSes.id, title: self.newSDoc.title, content: self.newSDoc.content};
        $http({url: "update-semantic-document", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                self.requestSemDocuments();
                Notification.success("Texto editado correctamente.");
                self.newSDoc = {id: null, title: "", content: ""};
            }
        });
    }

});

adpp.controller("QuestionsController", function ($scope, $http, Notification) {
    let self = $scope;

    self.qsLabels = ['A', 'B', 'C', 'D', 'E'];

    self.newQuestion = {
        id: null,
        content: "",
        alternatives: ["", "", "", "", ""],
        comment: "",
        other: "",
        textid: null,
        answer: -1
    };

    self.newText = {id: null, title: "", content: ""};

    self.selectAnswer = (i) => {
        self.newQuestion.answer = i;
    };

    self.addQuestion = () => {
        if (self.newQuestion.answer == -1) {
            Notification.error("Debe indicar la respuesta correcta a la pregunta");
            return;
        }
        let postdata = {
            content: self.newQuestion.content,
            options: self.newQuestion.alternatives.join("\n"),
            comment: self.newQuestion.comment,
            answer: self.newQuestion.answer,
            sesid: self.selectedSes.id,
            textid: self.newQuestion.textid,
            other: self.newQuestion.other
        };
        $http({url: "add-question", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                self.requestQuestions();
                Notification.success("Pregunta agrgada correctamente");
                self.newQuestion = {
                    id: null,
                    content: "",
                    alternatives: ["", "", "", "", ""],
                    comment: "",
                    other: "",
                    textid: null,
                    answer: -1
                };
            }
        });
    };

    self.updateQuestion = () => {
        if(self.newQuestion.id == null){
            Notification.error("No hay pregunta para editar");
            return;
        }
        if (self.newQuestion.answer == -1) {
            Notification.error("Debe indicar la respuesta correcta a la pregunta");
            return;
        }
        let postdata = {
            id: self.newQuestion.id,
            content: self.newQuestion.content,
            options: self.newQuestion.alternatives.join("\n"),
            comment: self.newQuestion.comment,
            answer: self.newQuestion.answer,
            sesid: self.selectedSes.id,
            textid: self.newQuestion.textid,
            other: self.newQuestion.other
        };
        $http({url: "update-question", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                self.requestQuestions();
                Notification.success("Pregunta editada correctamente");
                self.newQuestion = {
                    id: null,
                    content: "",
                    alternatives: ["", "", "", "", ""],
                    comment: "",
                    other: "",
                    textid: null,
                    answer: -1
                };
            }
        });
    };

    self.startEditQuestion = (qs) => {
        self.newQuestion = {
            id: qs.id,
            content: qs.content,
            alternatives: qs.options,
            comment: qs.comment,
            other: qs.other,
            textid: qs.textid,
            answer: qs.answer
        };
        Notification.info("Edite la pregunta en el formulario.");
    };

    self.startEditText = (tx) => {
        self.newText = {
            id: tx.id,
            title: tx.title,
            content: tx.content
        };
        Notification.info("Edite el texto en el formulario.");
    };

    self.addQuestionText = () => {
        let postdata = {sesid: self.selectedSes.id, title: self.newText.title, content: self.newText.content};
        $http({url: "add-question-text", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                self.requestQuestions();
                self.newText = {id: null, title: "", content: ""};
            }
        });
    };

    self.updateQuestionText = () => {
        if(self.newText.id == null){
            Notification.error("No hay texto para editar");
            return;
        }
        let postdata = {id: self.newText.id, sesid: self.selectedSes.id, title: self.newText.title, content: self.newText.content};
        $http({url: "update-question-text", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                self.requestQuestions();
                self.newText = {title: "", content: ""};
            }
        });
    };

    self.deleteQuestion = (id) => {
        let postdata = {id: id};
        $http.post("delete-question", postdata).success((data) => {
            self.requestQuestions();
            Notification.success("Pregunta eliminada correctamente");
        });
    };

    self.deleteQuestionText = (id) => {
        let postdata = {id: id};
        $http.post("delete-question-text", postdata).success((data) => {
            self.requestQuestions();
            Notification.success("Texto eliminado correctamente");
        });
    };

});

adpp.controller("DashboardController", function ($scope, $http, $timeout, $uibModal, Notification) {
    let self = $scope;
    self.iterationIndicator = 1;
    self.currentTimer = null;
    self.showCf = false;

    self.shared.resetGraphs = () => {
        if (self.selectedSes != null && self.selectedSes.type == "L") {
            self.iterationIndicator = Math.max(Math.min(6, self.selectedSes.status - 2), 0);
        }
        else if (self.selectedSes.type == "S") {
            self.iterationIndicator = Math.max(Math.min(3, self.selectedSes.status - 1), 1);
        }
        else if (self.selectedSes.type == "M") {
            self.iterationIndicator = Math.max(Math.min(6, self.selectedSes.status - 2), 0);
        }
        self.alumState = null;
        self.barOpts = {
            chart: {
                type: 'multiBarChart',
                height: 320,
                x: d => d.label,
                y: d => d.value,
                showControls: false,
                showValues: false,
                duration: 500,
                xAxis: {
                    showMaxMin: false
                },
                yAxis: {
                    axisLabel: 'Cantidad Alumnos'
                }
            }
        };
        self.barData = [{key: "Alumnos", color: "#4d6b87", values: []}];
        self.updateState();
        if (DASHBOARD_AUTOREALOD && self.selectedSes.status < 9) {
            self.reload(true);
        }
    };

    self.reload = (k) => {
        if (!k) {
            self.updateState();
        }
        if (self.currentTimer != null) {
            $timeout.cancel(self.currentTimer);
        }
        self.currentTimer = $timeout(self.reload, DASHBOARD_AUTOREALOD_TIME * 1000);
    };

    self.updateState = () => {
        if (self.iterationIndicator <= 4)
            self.updateStateIni();
        else
            self.updateStateRub();
    };

    self.shared.updateState = self.updateState;

    self.updateStateIni = () => {
        self.alumTime = {};
        let postdata = {sesid: self.selectedSes.id, iteration: self.iterationIndicator};
        if (self.selectedSes.type == "S") {
            $http({url: "get-alum-full-state-sel", method: "post", data: postdata}).success((data) => {
                self.alumState = {};
                for (let uid in self.users) {
                    if (self.users[uid].role == "A")
                        self.alumState[uid] = {};
                }
                data.forEach((d) => {
                    if (self.alumState[d.uid] == null) {
                        self.alumState[d.uid] = {};
                        self.alumState[d.uid][d.qid] = d.correct;
                    }
                    else {
                        self.alumState[d.uid][d.qid] = d.correct;
                    }
                });
                if (self.iterationIndicator == 3) {
                    $http({
                        url: "get-original-leaders",
                        method: "post",
                        data: {sesid: self.selectedSes.id}
                    }).success((data) => {
                        let temp = angular.copy(self.alumState);
                        self.alumState = {};
                        self.leaderTeamStr = {};
                        data.forEach((r) => {
                            self.alumState[r.leader] = temp[r.leader];
                            self.leaderTeamStr[r.leader] = r.team.map(u => (self.users[u]) ? self.users[u].name : "- ").join(", ");
                        });
                    });
                }
                self.shared.alumState = self.alumState;
            });
            $http({url: "get-alum-state-sel", method: "post", data: postdata}).success((data) => {
                let dataNorm = data.map(d => {
                    d.score /= self.questions.length;
                    return d;
                });
                self.buildBarData(dataNorm);
            });
            $http({url: "get-alum-confidence", method: "post", data: postdata}).success((data) => {
                 self.confidence = {};
                 data.forEach(r => {
                     if(!self.confidence[r.qid])
                         self.confidence[r.qid] = {};
                     self.confidence[r.qid][r.conf] = r.freq;
                 });
            });
        }
        else if (self.selectedSes.type == "L") {
            $http({url: "get-alum-state-lect", method: "post", data: postdata}).success((data) => {
                self.alumState = {};
                for (let uid in self.users) {
                    if (self.users[uid].role == "A")
                        self.alumState[uid] = {};
                }
                data.forEach((d) => {
                    if (self.alumState[d.uid] == null) {
                        self.alumState[d.uid] = d;
                    }
                    else {
                        self.alumState[d.uid] = d;
                    }
                });
                self.buildBarData(data);
                self.getAlumDoneTime(postdata);
                if (self.iterationIndicator == 3) {
                    $http({url: "get-original-leaders", method: "post", data: {sesid: self.selectedSes.id}}).success((data) => {
                        let temp = angular.copy(self.alumState);
                        self.alumState = {};
                        self.leaderTeamStr = {};
                        data.forEach((r) => {
                            self.alumState[r.leader] = temp[r.leader];
                            self.leaderTeamStr[r.leader] = r.team.map(u => (self.users[u]) ? self.users[u].name : "- ").join(", ");
                        });
                    });
                }
                self.shared.alumState = self.alumState;
            });
            $http({url: "get-ideas-progress", method: "post", data: postdata}).success((data) => {
                self.numProgress = 0;
                self.numUsers = Object.keys(self.users).length - 1;
                let n = self.documents.length * 3;
                if (n != 0) {
                    data.forEach((d) => {
                        self.numProgress += d.count / n;
                    });
                    self.numProgress *= 100 / self.numUsers;
                }
            });
        }
        else if (self.selectedSes.type == "M") {
            $http({url: "get-alum-state-semantic", method: "post", data: postdata}).success((data) => {
                self.alumState = {};
                self.numUsers = 0;
                for (let uid in self.users) {
                    if (self.users[uid].role == "A") {
                        self.alumState[uid] = {};
                        self.numUsers++;
                    }
                }
                data.forEach((d) => {
                    if (self.alumState[d.uid] == null) {
                        self.alumState[d.uid] = d;
                    }
                    else {
                        self.alumState[d.uid] = d;
                    }
                });
                self.buildBarData(data);
                self.getAlumDoneTime(postdata);
                if (self.iterationIndicator == 3) {
                    $http({url: "get-original-leaders", method: "post", data: {sesid: self.selectedSes.id}}).success((data) => {
                        let temp = angular.copy(self.alumState);
                        self.alumState = {};
                        self.leaderTeamStr = {};
                        data.forEach((r) => {
                            self.alumState[r.leader] = temp[r.leader];
                            self.leaderTeamStr[r.leader] = r.team.map(u => (self.users[u]) ? self.users[u].name : "- ").join(", ");
                        });
                    });
                }
                self.shared.alumState = self.alumState;
            });
            /*$http({url: "get-ideas-progress", method: "post", data: postdata}).success((data) => {
                self.numProgress = 0;
                self.numUsers = Object.keys(self.users).length - 1;
                let n = self.documents.length * 3;
                if (n != 0) {
                    data.forEach((d) => {
                        self.numProgress += d.count / n;
                    });
                    self.numProgress *= 100 / self.numUsers;
                }
            });*/
        }
    };

    self.avgAlum = (uid) => {
        if (self.alumState != null && self.alumState[uid] != null) {
            let t = 0;
            let c = 0;
            for (let k in self.alumState[uid]) {
                if (self.alumState[uid][k])
                    c++;
                t++;
            }
            return (t > 0) ? 100 * c / t : 0;
        }
        return 0;
    };


    self.avgPreg = (pid) => {
        if (self.alumState != null) {
            let t = 0;
            let c = 0;
            for (let k in self.alumState) {
                if (self.alumState[k] != null && self.alumState[k][pid] != null) {
                    if (self.alumState[k][pid])
                        c++;
                    t++;
                }
            }
            return (t > 0) ? 100 * c / t : 0;
        }
        return 0;
    };

    self.avgAll = () => {
        let t = 0;
        let c = 0;
        if (self.alumState != null) {
            for (let u in self.alumState) {
                for (let k in self.alumState[u]) {
                    if (self.alumState[u][k])
                        c++;
                    t++;
                }
            }
        }
        return (t > 0) ? 100 * c / t : 0;
    };

    self.progress = () => {
        let t = 0;
        if (self.alumState != null) {
            for (let u in self.alumState) {
                for (let k in self.alumState[u]) {
                    t++;
                }
            }
            return 100 * t / (Object.keys(self.alumState).length * self.questions.length);
        }
        return 0;
    };

    self.progressAlum = (uid) => {
        let t = 0;
        if (self.alumState != null && self.alumState[uid] != null) {
            for (let k in self.alumState[uid]) {
                t++;
            }
            return 100 * t / (self.questions.length);
        }
        return 0;
    };

    self.progressPreg = (pid) => {
        let t = 0;
        if (self.alumState != null) {
            for (let u in self.alumState) {
                if (self.alumState[u][pid] != null) {
                    t++;
                }
            }
            return 100 * t / (Object.keys(self.alumState).length);
        }
        return 0;
    };

    self.lectPerformance = () => {
        let t = 0;
        let c = 0;
        if (self.alumState != null) {
            for (let u in self.alumState) {
                var a = self.alumState[u];
                t++;
                c += a.score;
            }
            return 100 * c/t;
        }
        return 0;
    };

    self.getAlumDoneTime = (postdata) => {
        $http({url: "get-alum-done-time", method: "post", data: postdata}).success((data) => {
            self.numComplete = 0;
            data.forEach((row) => {
                self.numComplete += 1;
                if (self.alumState[row.uid] == null)
                    self.alumState[row.uid] = row;
                else
                    self.alumState[row.uid].dtime = ~~(row.dtime);
            });
        });
    };

    self.buildBarData = (data) => {
        const N = 5;
        self.barData[0].values = [];
        for (let i = 0; i < N; i++) {
            let lbl = (i * 20) + "% - " + ((i + 1) * 20) + "%";
            self.barData[0].values.push({label: lbl, value: 0});
        }
        data.forEach((d) => {
            let rank = Math.min(Math.floor(N * d.score), N - 1);
            self.barData[0].values[rank].value += 1;
        });
        self.barOpts.chart.xAxis.axisLabel = "Rendimiento";
    };

    self.updateStateRub = () => {
        if (self.iterationIndicator == 5)
            self.computeDif();
        else if (self.iterationIndicator == 6)
            self.getAllReportResult();
    };

    self.showName = (report) => {
        if (report.example)
            return report.title + " - Texto ejemplo";
        else
            return report.id + " - Reporte de Alumno " + self.users[report.uid].name;
    };

    self.shared.getReports = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "get-report-list", method: "post", data: postdata}).success((data) => {
            self.reports = data;
            self.exampleReports = data.filter(e => e.example);
        });
    };

    self.getReportResult = () => {
        let postdata = {repid: self.selectedReport.id};
        $http({url: "get-report-result", method: "post", data: postdata}).success((data) => {
            self.result = data;
            self.updateState();
        });
    };

    self.getAllReportResult = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "get-report-result-all", method: "post", data: postdata}).success((data) => {
            self.resultAll = {};
            for (let uid in self.users) {
                if (self.users[uid].role == "A")
                    self.resultAll[uid] = [];
            }
            data.forEach((d) => {
                if(d!=null && d.length > 0) {
                    let uid = self.getReportAuthor(d[0].rid);
                    if (uid != -1 && self.resultAll[uid] == null) {
                        self.resultAll[uid] = d;
                    }
                    else if(uid != -1) {
                        self.resultAll[uid] = d;
                    }
                }
            });
            self.pairArr = (data[0]) ? new Array(data[0].length) : [];
            self.buildRubricaBarData(data);
        });
    };

    self.buildRubricaBarData = (data) => {
        const N = 3;
        let rubnms = ["Inicio-Proceso", "Proceso-Competente", "Competente-Avanzado"];
        self.barData[0].values = [];
        for (let i = 0; i < N; i++) {
            let lbl = (i + 1) + " - " + (i + 2) + " (" + rubnms[i] + ")";
            self.barData[0].values.push({label: lbl, value: 0});
        }
        data.forEach((d) => {
            let score = d.reduce((e, v) => e + v.val, 0) / d.length;
            let rank = Math.min(Math.floor(score - 1), N - 1);
            self.barData[0].values[rank].value += 1;
        });
        self.barOpts.chart.xAxis.axisLabel = "Distribución de Puntaje (Nivel)";
    };

    self.computeDif = () => {
        if (self.result) {
            let pi = self.result.findIndex(e => self.users[e.uid].role == 'P');
            if (pi != -1) {
                let pval = self.result[pi].val;
                let difs = [];
                self.result.forEach((e, i) => {
                    if (i != pi) {
                        difs.push(Math.abs(pval - e.val));
                    }
                });
                self.buildRubricaDiffData(difs);
            }
        }
    };

    self.buildRubricaDiffData = (difs) => {
        console.log("difs", difs);
        const N = 5;
        let lblnms = ["Alto", "Medio Alto", "Medio", "Medio Bajo", "Bajo"];
        self.barData[0].values = [];
        for (let i = 0; i < N; i++) {
            // let lbl = (i * 0.5) + " - " + (i + 1) * 0.5;
            self.barData[0].values.push({label: lblnms[i], value: 0});
        }
        difs.forEach((d) => {
            let rank = Math.min(Math.floor(d * 2), N - 1);
            self.barData[0].values[rank].value += 1;
        });
        self.barOpts.chart.xAxis.axisLabel = "Cercanía a evaluación correcta";
    };

    self.getReportAuthor = (rid) => {
        if (self.reports) {
            let rep = self.reports.find(e => e.id == rid);
            return (rep) ? rep.uid : -1;
        }
        return -1;
    };

    self.getAvg = (row) => {
        if (row == null || row.length == 0) return "";
        let s = row.reduce((v, e) => v + e.val, 0);
        return s / row.length;
    };

    self.getInMax = (res) => {
        if (res == null) return [];
        let n = 0;
        for(let u in res){
            n = Math.max(n, res[u].length);
        }
        return new Array(n);
    };

    self.showReport = (rid) => {
        let postdata = {rid: rid};
        $http({url: "get-report", method: "post", data: postdata}).success((data) => {
            let modalData = {report: data, criterios: self.shared.obtainCriterios()};
            modalData.report.author = self.users[data.uid];
            let postdata = {repid: data.id};
            $http({url: "get-report-result", method: "post", data: postdata}).success((data) => {
                modalData.answers = data;
                $http.post("get-criteria-selection-by-report", postdata).success((data) => {
                    modalData.answersRubrica = {};
                    data.forEach((row) => {
                        if (modalData.answersRubrica[row.uid] == null)
                            modalData.answersRubrica[row.uid] = {};
                        modalData.answersRubrica[row.uid][row.cid] = row.selection;
                    });
                    $http.post("get-report-evaluators", postdata).success((data) => {
                        data.forEach(row => {
                            let i = modalData.answers.findIndex(e => e.uid == row.uid);
                            if(i == -1)
                                modalData.answers.push({uid: row.uid, evaluatorName: self.users[row.uid].name});
                            else
                                modalData.answers[i].evaluatorName = self.users[row.uid].name;
                        });
                        $uibModal.open({
                            templateUrl: "templ/report-details.html",
                            controller: "ReportModalController",
                            controllerAs: "vm",
                            size: "lg",
                            scope: self,
                            resolve: {
                                data: function () {
                                    return modalData;
                                },
                            }
                        });
                    });
                });
            });
        });
    };

    self.showReportByUid = (uid) => {
        console.log(uid);
        let postdata = {uid: uid, sesid: self.selectedSes.id};
        $http({url: "get-report-uid", method: "post", data: postdata}).success((data) => {
            let modalData = {report: data};
            modalData.report.author = self.users[uid];
            $uibModal.open({
                templateUrl: "templ/report-details.html",
                controller: "ReportModalController",
                controllerAs: "vm",
                scope: self,
                resolve: {
                    data: function () {
                        return modalData;
                    },
                }
            });
        });
    };

    self.broadcastReport = (rid) => {
        let postdata = {sesid: self.selectedSes.id, rid: rid};
        $http({url: "set-eval-report", method: "post", data: postdata}).success((data) => {
            Notification.success("Reporte enviado a alumnos");
        });
    };

    self.showDetailAnswer = (qid, uid, it) => {
        let opts = ["A", "B", "C", "D", "E"];
        let postdata = {uid: uid, qid: qid, iteration: it};
        $http({url: "get-selection-comment", method: "post", data: postdata}).success((data) => {
            let qs = self.questions.reduce((e,v) => (v.id == qid)? v : e, null);
            console.log(qs);
            let alt = opts[data.answer] + ". " + qs.options[data.answer];
            let qstxt = qs.content;
            $uibModal.open({
                templateUrl: "templ/content-dialog.html",
                controller: "ContentModalController",
                controllerAs: "vm",
                scope: self,
                resolve: {
                    data: function () {
                        data.title = "Respuesta de " + self.users[uid].name;
                        data.content = "Pregunta:\n" + qstxt + "\n\nRespuesta:\n" + alt + "\n\nComentario:\n" + data.comment;
                        if(data.confidence){
                            data.content += "\n\nGrado de Confianza: " + data.confidence + "%";
                        }
                        return data;
                    },
                }
            });
        });
    };

});

adpp.controller("ReportModalController", function ($scope, $uibModalInstance, data) {
    var vm = this;
    vm.data = data;

    vm.cancel = () => {
        $uibModalInstance.dismiss('cancel');
    };

});

adpp.controller("ContentModalController", function ($scope, $uibModalInstance, data) {
    var vm = this;
    vm.data = data;

    vm.cancel = () => {
        $uibModalInstance.dismiss('cancel');
    };

});

adpp.controller("DuplicateSesModalController", function ($scope, $http, $uibModalInstance, data) {
    var vm = this;
    vm.data = data;
    vm.nses = {
        name: vm.data.name,
        tipo: vm.data.type,
        descr: vm.data.descr,
        originalSesid: vm.data.id,
        copyDocuments: false,
        copyIdeas: false,
        copyQuestions: false,
        copyRubrica: false,
        copyUsers: false
    };

    vm.cancel = () => {
        $uibModalInstance.dismiss('cancel');
    };

    vm.sendDuplicate = () => {
        console.log(vm.nses);
        $http({url: "duplicate-session", method: "post", data: vm.nses}).success((data) => {
            console.log(data);
            window.location.reload();
        });
    };

});

adpp.controller("GroupController", function ($scope, $http, Notification) {
    let self = $scope;
    self.methods = ["Aleatorio", "Rendimiento Homogeneo", "Rendimiento Heterogeneo", "Tipo Aprendizaje Homogeneo", "Tipo Aprendizaje Heterogeoneo"];
    self.lastI = -1;
    self.lastJ = -1;

    self.shared.verifyGroups = () => {
        self.groupNum = 3;
        self.groupMet = self.methods[0];
        self.groups = [];
        self.groupNames = [];
        if (self.selectedSes != null && self.selectedSes.grouped) {
            self.groupNum = null;
            self.groupMet = null;
            self.generateGroups(true);
        }
    };

    self.generateGroups = (key) => {
        if (self.selectedSes.grouped) {
            $http({url: "group-proposal-sel", method: "post", data: {sesid: self.selectedSes.id}}).success((data) => {
                self.groups = data;
                //self.groupsProp = angular.copy(self.groups);
                console.log(data);
                //self.groupNames = [];
            });
            return;
        }
        if (key == null && (self.groupNum < 1 || self.groupNum > self.users.length)) {
            Notification.error("Error en los parámetros de formación de grupos");
            return;
        }

        let postdata = {
            sesid: self.selectedSes.id,
            gnum: self.groupNum,
            method: self.groupMet
        };

        console.log(self.shared.alumState);
        let users = Object.values(self.users).filter(e => e.role == "A");
        console.log(users);

        if (self.groupMet == "Tipo Aprendizaje Homogeneo" || self.groupMet == "Tipo Aprendizaje Heterogeoneo") {
            self.groups = generateTeams(users, habMetric, self.groupNum, isDifferent(self.groupMet));
        }
        else if (self.groupMet == "Aleatorio") {
            let arr = users.map(e => {
                e.rnd = Math.random();
                return e;
            });
            self.groups = generateTeams(arr, s => s.rnd, self.groupNum, false);
        }
        else if (self.selectedSes.type == "S") {
            let arr = [];
            for(let uid in self.shared.alumState){
                let s = 0;
                for(let q in self.shared.alumState[uid]){
                    s += +q;
                }
                arr.push({uid: uid, score: s});
            }
            self.groups = generateTeams(arr, s => s.score, self.groupNum, isDifferent(self.groupMet));
        }
        else if (self.selectedSes.type == "L" || self.selectedSes.type == "M") {
            self.groups = generateTeams(self.shared.alumState, s => s.score, self.groupNum, isDifferent(self.groupMet));
        }

        if(self.groups != null) {
            self.groupsProp = angular.copy(self.groups);
            self.groupNames = [];
        }

        /*if (urlRequest != "") {
            $http({url: urlRequest, method: "post", data: postdata}).success((data) => {
                self.groups = data;
                self.groupsProp = angular.copy(self.groups);
                console.log(data);
                self.groupNames = [];
                /*data.forEach((d) => {
                 self.groupNames.push(d.map(i => self.users[i.uid].name).join(", "));
                 });*
            });
        }*/
    };

    self.acceptGroups = () => {
        if (self.groupsProp == null) {
            Notification.error("No hay propuesta de grupos para fijar");
            return;
        }
        let postdata = {
            sesid: self.selectedSes.id,
            groups: JSON.stringify(self.groups.map(e => e.map(f => f.uid || f.id)))
        };
        console.log(postdata);
        $http({url: "set-groups", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                console.log("Groups accepted");
                self.selectedSes.grouped = true;
                self.shared.verifyGroups();
            }
        });
    };

    self.swapTable = (i, j) => {
        console.log(i, j, self.groups);
        if (self.lastI == -1 && self.lastJ == -1) {
            self.lastI = i;
            self.lastJ = j;
            return;
        }
        if (!(self.lastI == i && self.lastJ == j)) {
            let temp = angular.copy(self.groupsProp[i][j]);
            self.groupsProp[i][j] = angular.copy(self.groupsProp[self.lastI][self.lastJ]);
            self.groupsProp[self.lastI][self.lastJ] = temp;
        }
        self.lastI = -1;
        self.lastJ = -1;
    };

});

adpp.controller("RubricaController", function ($scope, $http) {
    let self = $scope;
    self.criterios = [];
    self.newCriterio = {};
    self.editable = false;
    self.exampleReports = [];
    self.newExampleReport = "";
    self.pairNum = 3;

    self.addCriterio = () => {
        self.criterios.push(self.newCriterio);
        self.newCriterio = {};
    };

    self.removeCriterio = (idx) => {
        self.criterios.splice(idx, 1);
    };

    self.checkSum = () => {
        return self.criterios.reduce((e, p) => e + p.pond, 0) == 100;
    };

    self.shared.getRubrica = () => {
        self.criterios = [];
        self.newCriterio = {};
        self.editable = false;
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "get-admin-rubrica", method: "post", data: postdata}).success((data) => {
            if (data.length == 0) {
                self.editable = true;
            }
            else {
                self.criterios = data;
            }
        });
    };

    self.saveRubrica = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "send-rubrica", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                let rid = data.id;
                self.criterios.forEach((criterio) => {
                    let postdata = angular.copy(criterio);
                    postdata.rid = rid;
                    $http({url: "send-criteria", method: "post", data: postdata}).success((data) => {
                        if (data.status == "ok") console.log("Ok");
                    });
                });
                self.editable = false;
            }
        });
    };

    self.shared.getExampleReports = () => {
        self.exampleReports = [];
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "get-example-reports", method: "post", data: postdata}).success((data) => {
            self.exampleReports = data;
        });
    };

    self.sendExampleReport = () => {
        let postdata = {
            sesid: self.selectedSes.id,
            content: self.newExampleReport.text,
            title: self.newExampleReport.title
        };
        $http({url: "send-example-report", method: "post", data: postdata}).success((data) => {
            self.newExampleReport = "";
            self.shared.getExampleReports();
        });
    };

    self.setActiveExampleReport = (rep) => {
        let postdata = {sesid: self.selectedSes.id, rid: rep.id};
        $http({url: "set-active-example-report", method: "post", data: postdata}).success((data) => {
            if (data.status == 'ok') {
                self.exampleReports.forEach(r => {
                    r.active = false;
                });
                rep.active = true;
            }
        });
    };

    self.goToReport = (rep) => {
        self.setActiveExampleReport(rep);
        window.location.href = "to-rubrica?sesid=" + self.selectedSes.id;
    };

    self.pairAssign = () => {
        let postdata = {sesid: self.selectedSes.id, rnum: +self.pairNum || 3};
        $http({url: "assign-pairs", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                self.selectedSes.paired = true;
                self.errPairMsg = "";
            }
            else {
                self.errPairMsg = data.msg;
            }
        });
    };

    self.shared.obtainCriterios = () => {
        return self.criterios;
    };

});

adpp.controller("OptionsController", function ($scope, $http, Notification) {
    let self = $scope;
    self.conf = {};
    self.sesidConfig = -1;
    self.options = [{name: "Ocultar Cometarios", code:"J"}, {name: "Grados de Certeza", code:"C"}];

    self.saveConfs = () => {
        let postdata = {
            sesid: self.selectedSes.id,
            options: self.buildConfStr()
        };
        $http.post("update-ses-options", postdata).success((data) => {
            if(data.status == "ok") {
                Notification.success("Opciones actualizadas");
                self.selectedSes.options = postdata.options;
            }
        });
    };

    self.updateConf = () => {
        if(self.selectedSes.id != self.sesidConfig) {
            self.conf = {};
            let op = self.selectedSes.options || "";
            for (var i = 0; i < op.length; i++) {
                self.conf[op[i]] = true;
            }
            self.sesidConfig = self.selectedSes.id;
        }
        return true;
    };

    self.buildConfStr = () => {
        let s = "";
        for(let key in self.conf){
            if(self.conf[key])
                s += key;
        }
        return s;
    };

});

adpp.controller("DashboardRubricaController", function ($scope, $http) {
    let self = $scope;
    self.reports = [];
    self.result = [];
    self.selectedReport = null;

    self.shared.resetRubricaGraphs = () => {
        self.alumState = null;
        self.barOpts = {
            chart: {
                type: 'multiBarChart',
                height: 320,
                x: d => d.label,
                y: d => d.value,
                showControls: false,
                showValues: false,
                duration: 500,
                xAxis: {
                    showMaxMin: false
                },
                yAxis: {
                    axisLabel: 'Cantidad Alumnos'
                }
            }
        };
        self.barData = [{key: "Alumnos", color: "#ef6c00", values: []}];
        //self.updateGraph();
    };

    self.shared.resetRubricaGraphs();

});

let generateTeams = (alumArr, scFun, n, different) => {
    if(n == null || n == 0) return [];
    let arr = alumArr;
    arr.sort((a, b) => scFun(b) - scFun(a));
    let groups = [];
    let numGroups = alumArr.length / n;
    for (let i = 0; i < numGroups; i++) {
        if (different) {
            let rnd = [];
            let offset = arr.length / n;
            for (let j = 0; j < n; j++)
                rnd.push(~~(Math.random() * offset + offset * j));
            groups.push(arr.filter((a, i) => rnd.includes(i)));
            arr = arr.filter((a, i) => !rnd.includes(i));
        }
        else{
            groups.push(arr.filter((a, i) => i < n));
            arr = arr.filter((a, i) => i >= n);
        }
    }
    let final_groups = [];
    let ov = 0;
    for(let i = 0; i < groups.length; i++){
        if(groups[i].length > 1 || final_groups.length == 0)
            final_groups.push(groups[i]);
        else {
            final_groups[ov % final_groups.length].push(groups[i][0]);
            ov++;
        }
    }
    return final_groups;
};

let isDifferent = (type) => {
    switch (type){
        case "Rendimiento Homogeneo":
            return false;
        case "Rendimiento Heterogeneo":
            return true;
        case "Tipo Aprendizaje Homogeneo":
            return false;
        case "Tipo Aprendizaje Heterogeoneo":
            return true;
    }
    return false;
};

let habMetric = (u) => {
    switch (u.aprendizaje){
        case "Teorico":
            return -2;
        case "Reflexivo":
            return -1;
        case "Activo":
            return 1;
        case "Pragmatico":
            return 2;
    }
    return 0;
};