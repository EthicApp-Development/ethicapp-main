window.StagesController = function($scope, $http, Notification){
    var self = $scope;

    self.stages = [];
    console.log(self.flang);

    var klg = function klg(k1, k2) {
        return {
            key: k1 + (k2 == null ? "" : " " + k2),
            name: self.flang(k1) + (k2 == null ? "" : " " + self.flang(k2))
        };
    };

    self.readonly = false;

    self.stage = {
        type: null,
        anon: false,
        chat: false,
        prevResponses: [],
        question: "",
    };

    self.stageRoles = [];

    self.roles = [];

    self.groups = [];
    self.groupopt = {
        met: null,
        num: null
    };

    self.currentStage = -1;

    self.setCurrentStage = function(i){
        if(i != -1){
            self.readonly = true;
            var postdata = {
                stageid: self.stages[i].id
            };
            $http({ url: "get-actors", method: "post", data: postdata }).success(function (data) {
                self.roles = data;
            });
            self.stage = self.stages[i];
        }
        else {
            self.readonly = false;
            self.stage = {
                type: null,
                anon: false,
                chat: false,
                question: self.stage.question,
                prevResponses: []
            };
        }
        self.currentStage = i;
    };

    self.getStages = function(){
        var postdata = {
            sesid: self.selectedSes.id
        };
        $http({ url: "get-admin-stages", method: "post", data: postdata }).success(function (data) {
            self.stages = data;
            self.stage.question = self.stages.length > 0 ? self.stages[self.stages.length - 1].question : "";
            var postdata = {
                stageid: self.selectedSes.current_stage
            };
            $http({ url: "get-actors", method: "post", data: postdata }).success(function (data) {
                self.roles = data;
            });
        });
    };

    self.changeStage = function(i){
        self.currentStage = i;
    };

    self.addRole = function(){
        self.roles.push({
            name: "",
            type: "order"
        });
    };

    self.setAllRolesType = function(type){
        for (let i = 0; i < self.roles.length; i++) {
            self.roles[i].type = type;
        }
    };

    self.removeRole = function (index) {
        self.roles.splice(index, 1);
    };

    self.sendStage = function(){
        var s = self.stage;
        if(s.type == null || self.roles.length == 0 || s.type == "team" && !self.groups){
            Notification.error("Hay datos faltantes");
            return;
        }
        var postdata = {
            number: self.stages.length + 1,
            question: s.question,
            grouping: s.type == "team" ? self.groupopt.num + ":" + self.groupopt.met : null,
            type: s.type,
            anon: s.anon,
            chat: s.chat,
            sesid: self.selectedSes.id,
            prev_ans: s.prevResponses.join(",")
        };
        $http({ url: "add-stage", method: "post", data: postdata }).success(function (data) {
            let stageid = data.id;
            if(stageid != null) {
                let c = self.roles.length;
                for (let i = 0; i < self.roles.length; i++) {
                    const role = self.roles[i];
                    let p = {
                        name: role.name,
                        jorder: role.type == "order",
                        justified: role.type != null,
                        stageid: stageid,
                    };
                    $http({ url: "add-actor", method: "post", data: p }).success(function (data) {
                        console.log("Actor added");
                        c -= 1;
                        if(c == 0){
                            let pp = {sesid: self.selectedSes.id, stageid: stageid};
                            $http({ url: "session-start-stage", method: "post", data: pp }).success(function (data) {
                                Notification.success("Etapa creada correctamente");
                                self.getStages();
                            });
                        }
                    });
                }
            }
            else {
                Notification.error("Error al crear la etapa");
            }
        });
    };

    self.setGroupal = function(){
        self.stage.type = 'team';
        self.methods = [klg("random"), klg("performance", "homog"), klg("performance", "heterg"), klg("knowledgeType", "homog"), klg("knowledgeType", "heterg")];
    };

    self.generateGroups = function (key) {
        console.log(self.groupopt.num, self.groupopt.met);
        if (self.selectedSes.grouped) {
            $http({ url: "group-proposal-sel", method: "post", data: { sesid: self.selectedSes.id } }).success(function (data) {
                self.groups = data;
                self.shared.groups = self.groups;
                //self.groupsProp = angular.copy(self.groups);
                console.log("G", data);
                //self.groupNames = [];
            });
            return;
        }
        if (key == null && (self.groupopt.num < 1 || self.groupopt.num > self.users.length)) {
            Notification.error("Error en los parámetros de formación de grupos");
            return;
        }

        var postdata = {
            sesid: self.selectedSes.id,
            gnum: self.groupopt.num,
            method: self.groupopt.met
        };

        console.log(postdata);

        console.log(self.shared.alumState);
        var users = Object.values(self.users).filter(function (e) {
            return e.role == "A";
        });
        console.log(users);

        if (self.groupopt.met == "knowledgeType homog" || self.groupopt.met == "knowledgeType heterg") {
            self.groups = generateTeams(users, habMetric, self.groupopt.num, isDifferent(self.groupopt.met));
        }
        else if (self.groupopt.met == "random") {
            var arr = users.map(function (e) {
                e.rnd = Math.random();
                return e;
            });
            self.groups = generateTeams(arr, function (s) {
                return s.rnd;
            }, self.groupopt.num, false);
        }
        else if (self.selectedSes.type == "E"){
            let dfd = users.map(e => {
                let d = (self.shared.dataDF || []);
                let r = d.find(f => f.tmid == e.id);
                console.log(r);
                return {
                    uid: e.id,
                    score: (r && r.ind && r.ind.length > 0) ? (r.ind.reduce((v,p) => v + p.sel, 0) / r.ind.length) : 0
                }
            });
            console.log(dfd);
            self.groups = generateTeams(dfd, function (s) {
                return s.score;
            }, self.groupopt.num, isDifferent(self.groupopt.met));
        }

        if (self.groups != null) {
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

    self.acceptGroups = function (stid) {
        if (self.groupsProp == null) {
            Notification.error("No hay propuesta de grupos para fijar");
            return;
        }
        var postdata = {
            stageid: self.selectedSes.stid,
            groups: JSON.stringify(self.groups.map(function (e) {
                return e.map(function (f) {
                    return f.uid || f.id;
                });
            }))
        };
        console.log(postdata);
        $http({ url: "set-groups-stage", method: "post", data: postdata }).success(function (data) {
            if (data.status == "ok") {
                console.log("Groups accepted");
                self.selectedSes.grouped = true;
                // self.shared.verifyGroups();
            }
        });
    };

    // self.swapTable = function (i, j) {
    //     console.log(i, j, self.groups);
    //     if (self.lastI == -1 && self.lastJ == -1) {
    //         self.lastI = i;
    //         self.lastJ = j;
    //         return;
    //     }
    //     if (!(self.lastI == i && self.lastJ == j)) {
    //         var temp = angular.copy(self.groupsProp[i][j]);
    //         self.groupsProp[i][j] = angular.copy(self.groupsProp[self.lastI][self.lastJ]);
    //         self.groupsProp[self.lastI][self.lastJ] = temp;
    //     }
    //     self.lastI = -1;
    //     self.lastJ = -1;
    // };

    self.getStages();

};

function groupByUser(data){
    let u = {};
    data.forEach(d => {
        if(!u[d.uid]){
            u[d.uid] = { arr: [] };
        }
        u[d.uid].arr.push(d.actorid);
    });
    return u;
}

window.computePosFreqTable = function(data, actors){
    if(data == null || actors == null || data.length == 0 || actors.length == 0){
        return;
    }
    let countMap = {};
    actors.forEach(a => {
        countMap[a.id] = {};
    });

    data.forEach(d => {
        countMap[d.actorid][d.orden] = countMap[d.actorid][d.orden] ? countMap[d.actorid][d.orden] + 1 : 1;
    });

    // console.log(countMap);
    return countMap;
};


function lehmerCode(arr, acts){
    let p = acts.map(e => e.id);
    let perm = arr.map(e => e);

    let n = p.length;
    let pos_map = {};
    p.forEach((e,i) => {
        pos_map[e] = i;
    });

    let w = [];
    for (let i = 0; i < n; i++) {
        let d = pos_map[perm[i]] - i;
        w.push(d);
        if(d == 0)
            continue;
        let t = pos_map[perm[i]];

        let tmp = pos_map[p[t]];
        pos_map[p[t]] = pos_map[p[i]];
        pos_map[p[i]] = tmp;

        tmp = p[t];
        p[t] = p[i];
        p[i] = tmp;
    }

    return w
}

function lehmerNum(code){
    let n = 0;
    for (let i = 0; i < code.length; i++) {
        let v = code[code.length - i - 1];
        n *= i;
        n += v;
    }
    return n;
}

function simpleNum(code){
    let n = 0;
    for (let i = 0; i < code.length; i++) {
        let v = code[code.length - i - 1];
        n *= code.length;
        n += v;
    }
    return n;
}


window.computeIndTable = function(data, actors){
    let udata = groupByUser(data);
    Object.values(udata).forEach(u => {
        u.code = lehmerCode(u.arr, actors);
        u.lnum = lehmerNum(u.code);

        u.perm = actors.map(e => u.arr.findIndex(s => s == e.id));
        u.pnum = simpleNum(u.perm);
    });
    return udata;
};
