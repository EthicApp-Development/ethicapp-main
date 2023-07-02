window.StagesController = function ($scope, $http, Notification, $uibModal) {
    var self = $scope;

    self.stages = [];

    function klg(k1, k2) {
        return {
            key:  k1 + (k2 == null ? "" : " " + k2),
            name: self.flang(k1) + (k2 == null ? "" : " " + self.flang(k2))
        };
    }

    self.readonly = false;

    self.stage = {
        type:          null,
        anon:          false,
        chat:          false,
        prevResponses: [],
        question:      "",
    };

    self.stageRoles = [];

    self.roles = [];
    self.jroles = [];
    self.colors = ["bg-qblue", "bg-red", "bg-green", "bg-yellow", "bg-purple", "bg-white"];
    self.dfs = [];

    self.groups = [];
    self.groupopt = {
        met: "previous",
        num: null
    };

    self.currentStage = -1;

    self.setCurrentStage = function (i) {
        if (i != -1) {
            self.readonly = true;
            var postdata = {
                stageid: self.stages[i].id
            };
            if (self.selectedSes.type == "R") {
                $http({url: "get-actors", method: "post", data: postdata}).success(function (data) {
                    self.roles = data;
                    self.roles.forEach(r => {
                        if(r.justified && r.jorder){
                            r.type = "order";
                        }
                        else if(r.justified){
                            r.type = "role";
                        }
                        r.wc = r.word_count;
                    });
                });
            }
            else if (self.selectedSes.type == "T") {
                $http({
                    url: "get-differentials-stage", method: "post", data: postdata
                }).success(function (data) {
                    self.dfs = data;
                    self.dfs.forEach(df => {
                        df.wc = df.word_count;
                        df.name = df.title;
                    });
                });
            }
            else if (self.selectedSes.type == "J") {
                $http({
                    url: "get-actors", method: "post", data: postdata
                }).success(function (data) {
                    self.roles = data;
                    self.roles.forEach(r => {
                        if(r.justified && r.jorder){
                            r.type = "order";
                        }
                        else if(r.justified){
                            r.type = "role";
                        }
                        r.wc = r.word_count;
                    });
                });
            }
            $http({
                url: "group-proposal-stage", method: "post", data: postdata
            }).success(function (data) {
                self.groups = data;
            });
            self.stage = self.stages[i];
        }
        else {
            self.readonly = false;
            self.stage = {
                type:          null,
                anon:          false,
                chat:          false,
                question:      self.stage.question,
                prevResponses: []
            };
        }
        self.currentStage = i;
    };

    self.getStages = function () {
        var postdata = {
            sesid: self.selectedSes.id
        };
        $http({
            url: "get-admin-stages", method: "post", data: postdata
        }).success(function (data) {
            self.stages = data;
            self.shared.stagesMap = {};
            data.forEach(function (s) {
                self.shared.stagesMap[s.id] = s;
            });
            self.stage.question = self.stages.length > 0 ?
                self.stages[self.stages.length - 1].question :
                "";
            var postdata = {
                stageid: self.selectedSes.current_stage
            };
            if(self.stages.length == 0){
                let postdata = {
                    sesid: self.selectedSes.id
                };
                $http.post("get-draft", postdata).success((data) => {
                    let d = JSON.parse(data.data);
                    self.dfs = d.dfs;
                    self.roles = d.roles;
                    self.jroles = d.jroles;
                });
            }
            else if (self.selectedSes.type == "R") {
                $http({
                    url: "get-actors", method: "post", data: postdata
                }).success(function (data) {
                    self.roles = data;
                    self.roles.forEach(r => {
                        if(r.justified && r.jorder){
                            r.type = "order";
                        }
                        else if(r.justified){
                            r.type = "role";
                        }
                        r.wc = r.word_count;
                    });
                });
            }
            else if (self.selectedSes.type == "T") {
                $http({
                    url: "get-differentials-stage", method: "post", data: postdata
                }).success(function (data) {
                    self.dfs = data;
                    self.dfs.forEach(df => {
                        df.wc = df.word_count;
                        df.name = df.title;
                    });
                });
            }
            else if (self.selectedSes.type == "J") {
                $http({
                    url: "get-actors", method: "post", data: postdata
                }).success(function (data) {
                    self.roles = data;
                    self.roles.forEach(r => {
                        if(r.justified && r.jorder){
                            r.type = "order";
                        }
                        else if(r.justified){
                            r.type = "role";
                        }
                        r.wc = r.word_count;
                    });
                });
                $http({
                    url: "get-jigsaw-roles", method: "post", data: { sesid: self.selectedSes.id }
                }).success(function (data) {
                    self.jroles = data;
                    self.inputAssignedRoles();
                });
            }
            $http({
                url: "group-proposal-stage", method: "post", data: postdata
            }).success(function (data) {
                self.groups = data;
                if (data.length > 0) {
                    self.groupopt.num = self.groups[0].length;
                }
                self.shared.groups = self.groups;
                self.shared.groupByUid = {};
                data.forEach(function (s, i) {
                    s.forEach(u => {
                        self.shared.groupByUid[u.uid] = {index: i + 1, tmid: u.tmid};
                    });
                });
            });
            if (self.selectedSes.status >= 3) {
                self.shared.setIterationIndicator(data[data.length - 1].id);
                self.setCurrentStage(data.length - 1);
            }
        });
    };

    self.changeStage = function (i) { 
        self.currentStage = i;
    };

    self.addRole = function () {
        self.roles.push({
            name: "",
            type: "role"
        });
    };

    self.addJRole = function () {
        self.jroles.push({
            name:        "",
            description: "",
            edit:        true
        });
    };

    self.setRoleType = function (role, type) {
        if(role.type == type){
            role.type = null;
            return;
        }
        if(self.roles.find(e => e.type != null && e.type != type)){
            self.setAllRolesType(null);
        }

        role.type = type;
    };

    self.setAllRolesType = function (type) {
        for (let i = 0; i < self.roles.length; i++) {
            self.roles[i].type = type;
        }
    };

    self.removeRole = function (index) {
        if (window.confirm("¿Esta seguro de eliminar este rol?")) {
            self.roles.splice(index, 1);
        }
    };

    self.removeJRole = function (index) {
        if (window.confirm("¿Esta seguro de eliminar este rol?")) {
            self.jroles.splice(index, 1);
        }
    };

    self.removeDF = function (index) {
        if (window.confirm("¿Esta seguro de eliminar esta pregunta?")) {
            self.dfs.splice(index, 1);
        }
    };

    self.checkStage = function(){
        if(self.selectedSes.type == "T"){
            if(self.dfs.some(e => e.name == "" || e.tleft == "" || e.tright == "")){
                return "Hay diferenciales con datos faltantes";
            }
        }
        if(self.selectedSes.type == "R" || self.selectedSes.type == "J"){
            if(self.roles.some(e => e.name == "")){
                return "Hay roles o lineas de acción con datos faltantes";
            }
        }
        if(self.selectedSes.type == "J"){
            if(self.jroles.some(e => e.name == "" || e.description == "")){
                return "Hay roles con datos faltantes";
            }
        }
    };

    self.sendStage = function () {
        var s = self.stage;
        let arr = self.selectedSes.type == "R" || self.selectedSes.type == "J" ?
            self.roles : self.dfs;
        let isFirst = self.stages.length == 0;
        if (s.type == null || arr.length == 0 || s.type == "team" && (
            self.groups == null || self.groups.length == 0
        )) {
            Notification.error("Hay datos de configuración faltantes");
            return;
        }
        let a = self.checkStage();
        if(a){
            Notification.error(a);
            return;
        }
        var postdata = {
            number:   self.stages.length + 1,
            question: s.question,
            grouping: s.type == "team" ? self.groupopt.num + ":" + self.groupopt.met : null,
            type:     s.type,
            anon:     s.anon,
            chat:     s.chat,
            sesid:    self.selectedSes.id,
            prev_ans: s.prevResponses.map(e => e.id).join(",")
        };
        var confirm = window.confirm(
            "¿Está seguro que quiere ir a la siguiente etapa? (Etapa " + (self.stages.length + 1) +
            ")"
        );
        if (!confirm) {
            return;
        }

        $http({url: "add-stage", method: "post", data: postdata}).success(function (data) {
            let stageid = data.id;
            if (stageid != null) {
                if (postdata.type == "team") {
                    self.acceptGroups(stageid);
                }
                if (self.selectedSes.type == "R") {
                    let c = self.roles.length;
                    for (let i = 0; i < self.roles.length; i++) {
                        const role = self.roles[i];
                        let p = {
                            name:       role.name,
                            jorder:     role.type == "order",
                            justified:  role.type != null,
                            word_count: role.wc,
                            stageid:    stageid,
                        };
                        $http({url: "add-actor", method: "post", data: p}).success(function () {
                            console.debug("Actor added");
                            c -= 1;
                            if (c == 0) {
                                let pp = {sesid: self.selectedSes.id, stageid: stageid};
                                $http({
                                    url: "session-start-stage", method: "post", data: pp
                                }).success(function () {
                                    Notification.success("Etapa creada correctamente");
                                    window.location.reload();
                                });
                            }
                        });
                    }
                }
                else if (self.selectedSes.type == "T") {
                    let c = self.dfs.length;
                    for (let i = 0; i < self.dfs.length; i++) {
                        const df = self.dfs[i];
                        let p = {
                            name:       df.name,
                            tleft:      df.tleft,
                            tright:     df.tright,
                            num:        df.num,
                            orden:      df.orden,
                            justify:    df.justify,
                            stageid:    stageid,
                            sesid:      self.selectedSes.id,
                            word_count: df.wc
                        };
                        $http({
                            url: "add-differential-stage", method: "post", data: p
                        }).success(function () {
                            c -= 1;
                            if (c == 0) {
                                let pp = {sesid: self.selectedSes.id, stageid: stageid};
                                $http({
                                    url: "session-start-stage", method: "post", data: pp
                                }).success(function () {
                                    Notification.success("Etapa creada correctamente");
                                    window.location.reload();
                                });
                            }
                        });
                    }
                }
                else if (self.selectedSes.type == "J") {
                    let c = self.roles.length + (isFirst ? self.jroles.length : 0);
                    for (let i = 0; i < self.roles.length; i++) {
                        const role = self.roles[i];
                        let p = {
                            name:       role.name,
                            jorder:     role.type == "order",
                            justified:  role.type != null,
                            word_count: role.wc,
                            stageid:    stageid,
                        };
                        $http({url: "add-actor", method: "post", data: p}).success(function () {
                            console.debug("Actor added");
                            c -= 1;
                            if (c == 0) {
                                let pp = {sesid: self.selectedSes.id, stageid: stageid};
                                $http({
                                    url: "session-start-stage", method: "post", data: pp
                                }).success(function () {
                                    Notification.success("Etapa creada correctamente");
                                });
                            }
                        });
                    }
                    if(isFirst){
                        for (let i = 0; i < self.jroles.length; i++) {
                            const jrole = self.jroles[i];
                            let p = {
                                name:        jrole.name,
                                sesid:       self.selectedSes.id,
                                description: jrole.description
                            };
                            $http({
                                url: "add-jigsaw-role", method: "post", data: p
                            }).success(function () {
                                console.debug("JRole added");
                                c -= 1;
                                if (c == 0) {
                                    let pp = {sesid: self.selectedSes.id, stageid: stageid};
                                    $http({
                                        url:    "session-start-stage",
                                        method: "post",
                                        data:   pp
                                    }).success(function () {
                                        Notification.success("Etapa creada correctamente");
                                    });
                                }
                            });
                        }
                    }
                }
            }
            else {
                Notification.error("Error al crear la etapa");
            }
        });
    };

    self.setGroupal = function () {
        self.stage.type = "team";
        self.methods = [
            klg("random"), klg("performance", "homog"), klg("performance", "heterg"),
            klg("knowledgeType", "homog"), klg("knowledgeType", "heterg")
        ];
        if (self.groups.length > 0) {
            self.methods.unshift(klg("previous"));
        }
    };

    self.generateGroups = function (key, stage) {
        if(stage != null){
            self.groupopt.num = self.design.phases[stage].stdntAmount;
            self.groupopt.met = self.design.phases[stage].grouping_algorithm;
        }
        console.log(self.groupopt.met, self.selectedSes.grouped, self.groups);
        if (self.groupopt.met == "previous") {
            console.log("Ignore, keeps groups");
            return;
        }
        // 1 ignore
        if (self.selectedSes.grouped && self.groupopt.met == "previous") {
            $http({
                url:    "group-proposal-sel",
                method: "post",
                data:   {sesid: self.selectedSes.id}
            }).success(function (data) {
                self.groups = data;
                self.shared.groups = self.groups;
            });
            return;
        }
        if (key == null && (self.groupopt.num < 1 || self.groupopt.num > self.users.length)) {
            console.log("Error, low users");
            Notification.error("Error en los parámetros de formación de grupos");
            return;
        }
        console.log(self.groupopt.met);
        // *1 ignore
        var postdata = {
            sesid:  self.selectedSes.id,
            gnum:   self.groupopt.num,
            method: self.groupopt.met
        };

        var users = Object.values(self.users).filter(function (e) {
            return e.role == "A";
        });

        if (
            self.groupopt.met == "knowledgeType homog" ||
            self.groupopt.met == "knowledgeType heterg"
        ) {
            self.groups = generateTeams(
                users, habMetric, self.groupopt.num, isDifferent(self.groupopt.met)
            );
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
        else if (self.selectedSes.type == "T"){
            let d = self.shared.difTable.filter(e => !e.group);
            let dfd = users.map(e => {
                let r = d.find(dd => dd.uid == e.id);
                return {
                    uid:   e.id,
                    score: (r && r.arr && r.arr.length > 0) ? (
                        r.arr.reduce((v, p) => v + (p.sel != null ? p.sel : -1), 0) / r.arr.length
                    ) : -1,
                    aprendizaje: e.aprendizaje
                };
            });
            self.groups = generateTeams(
                dfd, s => s.score, self.groupopt.num, isDifferent(self.groupopt.met)
            );
        }
        else if (self.selectedSes.type == "R") {
            let dfd = users.map(e => {
                return {
                    uid:   e.id,
                    score: self.shared.roleIndTable[e.id] ?
                        self.shared.roleIndTable[e.id].lnum : -1,
                    aprendizaje: e.aprendizaje
                };
            });
            self.groups = generateTeams(
                dfd, function (s) {
                    return s.score;
                },
                self.groupopt.num,
                isDifferent(self.groupopt.met)
            );
        }
        else if(self.groupopt.met == "expert"){
            let s = {};
            users.forEach(u => {
                if(!s[u.jigsawId])
                    s[u.jigsawId] = [];
                s[u.jigsawId].push(u);
            });
            self.groups = Object.values(s);
        }
        else if(self.groupopt.met == "wjigsaw"){
            let s = {};
            users.forEach(u => {
                if(!s[u.jigsawId])
                    s[u.jigsawId] = [];
                s[u.jigsawId].push(u);
            });
            let roles = Object.keys(s);
            let gs = [];
            let hasData = true;
            for (let i = 0; hasData; i++) {
                hasData = false;
                let g = [];
                roles.forEach(r => {
                    if(s[r][i]){
                        hasData = true;
                        g.push(s[r][i]);
                    }
                });
                if(hasData){
                    gs.push(g);
                }
            }
            self.groups = gs;
        }
        else if(self.groupopt.met == "wjigsawrep"){
            let s = {};
            users.forEach(u => {
                if(!s[u.jigsawId])
                    s[u.jigsawId] = [];
                s[u.jigsawId].push(u);
            });
            let roles = Object.keys(s);
            let gs = [];
            let hasData = true;
            for (let i = 0; hasData; i++) {
                hasData = false;
                let g = [];
                roles.forEach(r => {
                    if(s[r][i]){
                        hasData = true;
                        g.push(s[r][i]);
                    }
                });
                if(hasData){
                    gs.push(g);
                }
            }
            // CHECK MISSING ROLES IN LAST GROUP
            if(gs[0].length != gs[gs.length - 1].length){
                let lastgroup = gs.pop();
                for (let i = 0; i < lastgroup.length; i++) {
                    gs[i % gs.length].push(lastgroup[i]);
                }
            }
            self.groups = gs;
        }

        if (self.groups != null) {
            self.groupsProp = angular.copy(self.groups);
            self.groupNames = [];
        }
    };

    self.acceptGroups = function (stid) {
        if (self.groups == null) {
            Notification.error("No hay propuesta de grupos para fijar");
            return;
        }
        var postdata = {
            stageid: stid,
            groups:  JSON.stringify(self.groups.map(function (e) {
                return e.map(function (f) {
                    return f.uid || f.id;
                });
            }))
        };
        $http({url: "set-groups-stage", method: "post", data: postdata}).success(function (data) {
            if (data.status == "ok") {
                self.selectedSes.grouped = true;
            }
        });
    };

    self.formatStageNames = (idstr) => {
        if (idstr == null || idstr == "")
            return;
        let ids = idstr.split(",").map(e => +e);
        return ids.map(i => {
            let s = self.stages.find(s => s.id == i);
            return self.flang("stage") + " " + s.number;
        }).join(", ");
    };

    self.shared.openNextModal = () => {
        $uibModal.open({
            templateUrl: "../../frontend/static/next-dialog.html",
            controller:  function ($scope, $http, $uibModalInstance, Notification, data) {
                var vm = this;
                vm.data = data;
                vm.radioval = null;

                vm.cancel = function () {
                    $uibModalInstance.dismiss("cancel");
                };

                vm.accept = function () {
                    if (vm.radioval == "F") {
                        $http.post(
                            "session-finish-stages", { sesid: self.selectedSes.id }
                        ).success((data) => {
                            console.debug(data);
                        });
                    }
                    else if (vm.radioval == "N") {
                        self.setTab("editor");
                        $uibModalInstance.dismiss("cancel");
                    }
                };
            },
            controllerAs: "vm",
            scope:        self,
            resolve:      {
                data: function data() {
                    return {};
                }
            }
        });
    };

    self.getGrouping = (gstr) => {
        if (gstr == null || gstr == "") {
            return self.flang("prevGroups");
        }
        let cmps = gstr.split(":");
        let meths = cmps[1].split(" ");
        if(meths[0] == "jigsaw" || meths[0] == "expert"){
            return self.flang("groupingMethod") + ": " + klg(meths[0], meths[1]).name;
        }
        return self.flang("studentsPerGroup") + ": " + cmps[0] + ", " + self.flang("groupingMethod")
            + ": " + klg(meths[0], meths[1]).name;
    };

    self.addDF = () => {
        self.dfs.push({
            name:    "",
            tleft:   "",
            tright:  "",
            num:     7,
            orden:   self.dfs.length + 1,
            justify: true
        });
    };

    self.buildArray = (n) => {
        let a = [];
        for (let i = 1; i <= n; i++) {
            a.push(i);
        }
        return a;
    };

    self.inputAssignedRoles = () => {
        $http.post("get-assigned-jigsaw-roles", {
            sesid: self.selectedSes.id
        }).success((data) => {
            data.forEach(d => {
                let u = self.users[d.userid];
                if(u){
                    u.jigsaw = self.jroles.find(e => e.id == d.roleid);
                    u.jigsawId = d.roleid;
                }
            });
        });
    };

    self.saveDraft = () => {
        let data = {
            dfs:    self.dfs,
            roles:  self.roles,
            jroles: self.jroles,
        };
        let postdata = {
            sesid: self.selectedSes.id,
            data:  JSON.stringify(data),
        };
        $http.post("save-draft", postdata).success(() => {
            Notification.success("Datos guardados");
        });
    };

    self.shared.inputAssignedRoles = self.inputAssignedRoles;
    self.shared.buildArray = self.buildArray;
    self.shared.getStages = self.getStages;

    self.getStages();
};


function groupByUser(data, acts) {
    let u = {};
    let jusOrder = acts.some(e => e.jorder);
    data.forEach(d => {
        if (!u[d.uid]) {
            u[d.uid] = {arr: [], com: [], just: []};
        }
        let a = jusOrder ? acts[u[d.uid].arr.length] : acts.find(e => e.id == d.actorid);
        u[d.uid].arr.push(d.actorid);
        u[d.uid].com.push(d.description);
        u[d.uid].just.push(a && a.justified);
    });
    return u;
}

window.computePosFreqTable = function (data, actors) {
    if (data == null || actors == null || data.length == 0 || actors.length == 0) {
        return;
    }
    let countMap = {};
    actors.forEach(a => {
        countMap[a.id] = {};
    });

    data.forEach(d => {
        countMap[d.actorid][d.orden] = countMap[d.actorid][d.orden] ?
            countMap[d.actorid][d.orden] + 1 : 1;
    });
    return countMap;
};


function lehmerCode(arr, acts) {
    let p = acts.map(e => e.id);
    let perm = arr.map(e => e);

    let n = p.length;
    let pos_map = {};
    p.forEach((e, i) => {
        pos_map[e] = i;
    });

    let w = [];
    for (let i = 0; i < n; i++) {
        let d = pos_map[perm[i]] - i;
        w.push(d);
        if (d == 0)
            continue;
        let t = pos_map[perm[i]];

        let tmp = pos_map[p[t]];
        pos_map[p[t]] = pos_map[p[i]];
        pos_map[p[i]] = tmp;

        tmp = p[t];
        p[t] = p[i];
        p[i] = tmp;
    }

    return w;
}


function lehmerNum(code) {
    let n = 0;
    for (let i = 0; i < code.length; i++) {
        let v = code[code.length - i - 1];
        n *= i;
        n += v;
    }
    return n;
}


function simpleNum(code) {
    let n = 0;
    for (let i = 0; i < code.length; i++) {
        let v = code[code.length - i - 1];
        n *= code.length;
        n += v;
    }
    return n;
}


window.computeIndTable = function (data, actors) {
    let udata = groupByUser(data, actors);
    Object.values(udata).forEach(u => {
        u.code = lehmerCode(u.arr, actors);
        u.lnum = lehmerNum(u.code);

        u.perm = actors.map(e => u.arr.findIndex(s => s == e.id));
        u.pnum = simpleNum(u.perm);
    });

    let uarr = Object.values(udata);
    uarr.forEach(u => {
        u.ceq = uarr.filter(e => e.pnum == u.pnum).length;
    });

    return udata;
};


window.sortIndTable = function (table, users) {
    var us = Object.values(users).filter(function (e) {
        return e.role == "A";
    });
    us.forEach(u => {
        if (!table[u.id]) {
            table[u.id] = {
                arr:  [],
                ceq:  0,
                lnum: -1
            };
        }
    });
    let arr = Object.entries(table).map(([uid, e]) => {
        e.uid = uid;
        e.uid2 = uid;
        e.ceqlnum = e.ceq + e.pnum / 1e7;
        return e;
    });
    return arr;
};


window.buildDifTable = function(data, users, dfs, gbu) {
    let res = [];
    let tmids = {};
    var us = Object.values(users).filter(function (e) {
        return e.role == "A";
    });
    for (let i = 0; i < us.length; i++) {
        const u = us[i];
        let row = {
            uid: u.id,
            arr: dfs.map(d => data.find(e => e.uid == u.id && d.id == e.did) || { did: d.id })
        };
        row.tmid = row.arr.find(e => e && e.tmid != null) ?
            row.arr.find(e => e && e.tmid != null).tmid :
            (gbu && gbu[u.id] ? gbu[u.id].tmid : null);
        if (row.tmid != null)
            tmids[row.tmid] = true;
        res.push(row);
    }

    let tres = [];
    function avg (arr)  {
        return arr.length > 0 ? arr.reduce((v, e) => v + e, 0) / arr.length : 0;
    }
    function sdf  (arr) {
        if (arr.length <= 1)
            return 0;
        let av = avg(arr);
        let sd = 0;
        arr.forEach(function (a) {
            sd += (a - av) * (a - av);
        });
        return Math.sqrt(sd / (arr.length - 1)) / av;
    }
    Object.keys(tmids).forEach(t => {
        let r = res.filter(e => e.tmid == t);
        let row = {
            uid:   -t,
            tmid:  +t,
            group: true,
            arr:   dfs.map((e, i) => ({
                sel: avg(r.map(e => e.arr[i] ? e.arr[i].sel : null).filter(e => e)),
                sd:  sdf(r.map(e => e.arr[i] ? e.arr[i].sel : null).filter(e => e)),
                did: e.id
            }))
        };
        users[-t] = {
            name: `•G${t}`,
            type: "G"
        };
        tres.push(row);
    });

    res = res.concat(tres);

    return res;
};
