import { generateTeams, isDifferent } from "../../helpers/util.js";
export function StagesController($scope, $http, Notification, $uibModal,
    ActivityStateService) {
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

    self.setCurrentStage = async function (i) {
        if (i !== -1) {
            self.readonly = true;
            const postdata = { stageid: self.stages[i].id };
    
            try {
                // Fetch roles or differentials based on session type
                if (ActivityStateService.sessionDescriptor.type === "R") {
                    const rolesResponse = await $http({
                        url: "get-actors",
                        method: "post",
                        data: postdata
                    });
                    self.roles = rolesResponse.data;
                    self.roles.forEach(r => {
                        if (r.justified && r.jorder) {
                            r.type = "order";
                        } else if (r.justified) {
                            r.type = "role";
                        }
                        r.wc = r.word_count;
                    });
                } else if (ActivityStateService.sessionDescriptor.type === "T") {
                    const dfsResponse = await $http({
                        url: "get-differentials-stage",
                        method: "post",
                        data: postdata
                    });
                    self.dfs = dfsResponse.data;
                    self.dfs.forEach(df => {
                        df.wc = df.word_count;
                        df.name = df.title;
                    });
                } else if (ActivityStateService.sessionDescriptor.type === "J") {
                    const rolesResponse = await $http({
                        url: "get-actors",
                        method: "post",
                        data: postdata
                    });
                    self.roles = rolesResponse.data;
                    self.roles.forEach(r => {
                        if (r.justified && r.jorder) {
                            r.type = "order";
                        } else if (r.justified) {
                            r.type = "role";
                        }
                        r.wc = r.word_count;
                    });
                }
    
                // Fetch groups proposal
                const groupsResponse = await $http({
                    url: "group-proposal-stage",
                    method: "post",
                    data: postdata
                });
                self.groups = groupsResponse.data;
    
                // Set current stage
                self.stage = self.stages[i];
            } catch (error) {
                console.error("Error setting current stage:", error);
                Notification.error("Error al configurar la etapa actual");
            }
        } else {
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
    
    self.getStages = async function () {
        try {
            const postdata = { sesid: ActivityStateService.sessionDescriptor.id };
            
            // Step 1: Fetch all stages
            const stagesResponse = await $http({
                url: "get-admin-stages",
                method: "post",
                data: postdata
            });
            self.stages = stagesResponse.data;
            self.shared.stagesMap = {};
            
            self.stages.forEach(s => {
                self.shared.stagesMap[s.id] = s;
            });
            
            self.stage.question = self.stages.length > 0
                ? self.stages[self.stages.length - 1].question
                : "";
    
            // Step 2: Fetch draft if no stages exist
            if (self.stages.length === 0) {
                const draftResponse = await $http.post("get-draft", postdata);
                const draftData = JSON.parse(draftResponse.data.data);
                self.dfs = draftData.dfs;
                self.roles = draftData.roles;
                self.jroles = draftData.jroles;
            } else {
                const stagePostData = { stageid: ActivityStateService.sessionDescriptor.current_stage };
                
                // Step 3: Fetch data based on session type
                if (ActivityStateService.sessionDescriptor.type === "R") {
                    const rolesResponse = await $http({
                        url: "get-actors",
                        method: "post",
                        data: stagePostData
                    });
                    self.roles = rolesResponse.data;
                    self.roles.forEach(r => {
                        r.type = r.justified && r.jorder ? "order" : r.justified ? "role" : null;
                        r.wc = r.word_count;
                    });
                } else if (ActivityStateService.sessionDescriptor.type === "T") {
                    const dfsResponse = await $http({
                        url: "get-differentials-stage",
                        method: "post",
                        data: stagePostData
                    });
                    self.dfs = dfsResponse.data;
                    self.dfs.forEach(df => {
                        df.wc = df.word_count;
                        df.name = df.title;
                    });
                } else if (ActivityStateService.sessionDescriptor.type === "J") {
                    const rolesResponse = await $http({
                        url: "get-actors",
                        method: "post",
                        data: stagePostData
                    });
                    self.roles = rolesResponse.data;
                    self.roles.forEach(r => {
                        r.type = r.justified && r.jorder ? "order" : r.justified ? "role" : null;
                        r.wc = r.word_count;
                    });
    
                    const jigsawRolesResponse = await $http({
                        url: "get-jigsaw-roles",
                        method: "post",
                        data: { sesid: ActivityStateService.sessionDescriptor.id }
                    });
                    self.jroles = jigsawRolesResponse.data;
                    self.inputAssignedRoles();
                }
    
                // Step 4: Fetch group proposals
                const groupsResponse = await $http({
                    url: "group-proposal-stage",
                    method: "post",
                    data: stagePostData
                });
                self.groups = groupsResponse.data;
                if (self.groups.length > 0) {
                    self.groupopt.num = self.groups[0].length;
                }
                self.shared.groups = self.groups;
                self.shared.groupByUid = {};
                self.groups.forEach((group, i) => {
                    group.forEach(u => {
                        self.shared.groupByUid[u.uid] = { index: i + 1, tmid: u.tmid };
                    });
                });
    
                // Step 5: Set current stage and iteration indicator if session is active
                if (ActivityStateService.sessionDescriptor.status >= 3) {
                    self.shared.setIterationIndicator(self.stages[self.stages.length - 1].id);
                    self.setCurrentStage(self.stages.length - 1);
                }
            }
        } catch (error) {
            console.error("Error fetching stages:", error);
            Notification.error("Error al obtener las etapas");
        }
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
        if(ActivityStateService.sessionDescriptor.type == "T"){
            if(self.dfs.some(e => e.name == "" || e.tleft == "" || e.tright == "")){
                return "Hay diferenciales con datos faltantes";
            }
        }
        if(ActivityStateService.sessionDescriptor.type == "R" || ActivityStateService.sessionDescriptor.type == "J"){
            if(self.roles.some(e => e.name == "")){
                return "Hay roles o lineas de acción con datos faltantes";
            }
        }
        if(ActivityStateService.sessionDescriptor.type == "J"){
            if(self.jroles.some(e => e.name == "" || e.description == "")){
                return "Hay roles con datos faltantes";
            }
        }
    };

    self.sendStage = async function () {
        try {
            const s = self.stage;
            const arr = ["R", "J"].includes(ActivityStateService.sessionDescriptor.type) ? 
                self.roles : self.dfs;
            const isFirst = self.stages.length === 0;
            
            if (!s.type || arr.length === 0 || (s.type === "team" && 
                    (!self.groups || self.groups.length === 0))) {
                Notification.error("Hay datos de configuración faltantes");
                return;
            }
    
            const a = self.checkStage();
            if (a) {
                Notification.error(a);
                return;
            }
    
            const confirm = window.confirm(
                `¿Está seguro que quiere ir a la siguiente etapa? (Etapa ${self.stages.length + 1})`
            );
            if (!confirm) return;
    
            const postdata = {
                number: self.stages.length + 1,
                question: s.question,
                grouping: s.type === "team" ? `${self.groupopt.num}:${self.groupopt.met}` : null,
                type: s.type,
                anon: s.anon,
                chat: s.chat,
                sesid: ActivityStateService.sessionDescriptor.id,
                prev_ans: s.prevResponses.map(e => e.id).join(",")
            };
    
            const addStageResponse = await $http.post("add-stage", postdata);
            const stageid = addStageResponse.data.id;
    
            if (!stageid) {
                Notification.error("Error al crear la etapa");
                return;
            }
    
            // Handle 'team' type stages
            if (postdata.type === "team") {
                await self.acceptGroups(stageid);
            }
    
            const { sessionType, sessionId } = ActivityStateService.sessionDescriptor;
            
            if (sessionType === "R") {
                await self.addRoles(stageid);
            } else if (sessionType === "T") {
                await self.addDifferentials(stageid);
            } else if (sessionType === "J") {
                await self.addRoles(stageid);
                if (isFirst) {
                    await self.addJigsawRoles(stageid);
                }
            }
    
            await $http.post("session-start-stage", { sesid: sessionId, stageid });
            window.location.reload();
        } catch (error) {
            console.error("Error in sendStage:", error);
        }
    };
    
    // Helper methods for managing roles and differentials
    self.addRoles = async function (stageid) {
        const roles = self.roles;
        for (const role of roles) {
            const p = {
                name: role.name,
                jorder: role.type === "order",
                justified: role.type != null,
                word_count: role.wc,
                stageid
            };
            await $http.post("add-actor", p);
            console.debug("Actor added");
        }
    };
    
    self.addDifferentials = async function (stageid) {
        const dfs = self.dfs;
        for (const df of dfs) {
            const p = {
                name: df.name,
                tleft: df.tleft,
                tright: df.tright,
                num: df.num,
                orden: df.orden,
                justify: df.justify,
                stageid,
                sesid: ActivityStateService.sessionDescriptor.id,
                word_count: df.wc
            };
            await $http.post("add-differential-stage", p);
        }
    };
    
    self.addJigsawRoles = async function (stageid) {
        const jroles = self.jroles;
        for (const jrole of jroles) {
            const p = {
                name: jrole.name,
                sesid: ActivityStateService.sessionDescriptor.id,
                description: jrole.description
            };
            await $http.post("add-jigsaw-role", p);
            console.debug("JRole added");
        }
    };
    
    self.setGroupal = function () {
        self.stage.type = "team";
        self.methods = [
            klg("random"), klg("performance", "homog"), klg("performance", "heterg")
        ];
        if (self.groups.length > 0) {
            self.methods.unshift(klg("previous"));
        }
    };

    self.generateGroups = async function (key, stage) {
        try {
            if (stage != null) {
                self.groupopt.num = self.design.phases[stage].stdntAmount;
                self.groupopt.met = self.design.phases[stage].grouping_algorithm;
            }
            
            console.log(self.groupopt.met, ActivityStateService.sessionDescriptor.grouped, 
                self.groups);
            
            if (self.groupopt.met === "previous") {
                console.log("Ignore, keeps groups");
                return;
            }
            
            if (ActivityStateService.sessionDescriptor.grouped && 
                    self.groupopt.met === "previous") {
                const data = await $http.post("group-proposal-sel", 
                    { sesid: ActivityStateService.sessionDescriptor.id });
                self.groups = data.data;
                self.shared.groups = self.groups;
                return;
            }
            
            if (key == null && (self.groupopt.num < 1 || self.groupopt.num > self.users.length)) {
                console.log("Error, low users");
                Notification.error("Error en los parámetros de formación de grupos");
                return;
            }
    
            const postdata = {
                sesid: ActivityStateService.sessionDescriptor.id,
                gnum: self.groupopt.num,
                method: self.groupopt.met
            };
    
            const users = Object.values(self.users).filter(user => user.role === "A");
            
            switch (self.groupopt.met) {
                case "random":
                    const randomUsers = users.map(user => ({ ...user, rnd: Math.random() }));
                    self.groups = generateTeams(randomUsers, s => s.rnd, self.groupopt.num, false);
                    break;
    
                case "expert":
                    self.groups = groupByJigsawId(users);
                    break;
    
                case "wjigsaw":
                case "wjigsawrep":
                    self.groups = await generateWeightedJigsawGroups(users, self.groupopt.met === "wjigsawrep");
                    break;
    
                default:
                    await handleSpecialGrouping(users);
            }
    
            if (self.groups) {
                self.groupsProp = angular.copy(self.groups);
                self.groupNames = [];
            }
    
        } catch (error) {
            console.error("Error in generateGroups:", error);
            Notification.error("Error al formar los grupos");
        }
    };
    
    // Helper functions
    function groupByJigsawId(users) {
        const grouped = users.reduce((acc, user) => {
            if (!acc[user.jigsawId]) acc[user.jigsawId] = [];
            acc[user.jigsawId].push(user);
            return acc;
        }, {});
        return Object.values(grouped);
    }
    
    async function generateWeightedJigsawGroups(users, redistributeLastGroup) {
        const grouped = groupByJigsawId(users);
        const roles = Object.keys(grouped);
        let groups = [];
        let hasData = true;
    
        for (let i = 0; hasData; i++) {
            hasData = false;
            let group = roles.reduce((acc, role) => {
                if (grouped[role][i]) {
                    hasData = true;
                    acc.push(grouped[role][i]);
                }
                return acc;
            }, []);
            if (hasData) groups.push(group);
        }
    
        if (redistributeLastGroup && groups[0].length !== groups[groups.length - 1].length) {
            const lastGroup = groups.pop();
            lastGroup.forEach((member, index) => groups[index % groups.length].push(member));
        }
        
        return groups;
    }
    
    async function handleSpecialGrouping(users) {
        if (ActivityStateService.sessionDescriptor.type === "T") {
            const filteredData = self.shared.difTable.filter(e => !e.group);
            const scores = users.map(user => {
                const result = filteredData.find(d => d.uid === user.id);
                return {
                    uid: user.id,
                    score: (result && result.arr && result.arr.length > 0)
                        ? result.arr.reduce((sum, entry) => sum + (entry.sel != null ? entry.sel : -1), 0) / result.arr.length
                        : -1
                };
            });
            self.groups = generateTeams(scores, s => s.score, self.groupopt.num, isDifferent(self.groupopt.met));
        } else if (ActivityStateService.sessionDescriptor.type === "R") {
            const scores = users.map(user => ({
                uid: user.id,
                score: self.shared.roleIndTable[user.id] ? self.shared.roleIndTable[user.id].lnum : -1
            }));
            self.groups = generateTeams(scores, s => s.score, self.groupopt.num, isDifferent(self.groupopt.met));
        }
    }
    
    self.acceptGroups = async function (stid) {
        if (self.groups == null) {
            Notification.error("No hay propuesta de grupos para fijar");
            return;
        }
    
        const postdata = {
            stageid: stid,
            groups: JSON.stringify(self.groups.map(group => group.map(user => user.uid || user.id)))
        };
    
        try {
            const response = await $http.post("set-groups-stage", postdata);
            if (response.data.status === "ok") {
                ActivityStateService.sessionDescriptor.grouped = true;
            }
        } catch (error) {
            console.error("Error setting groups:", error);
            Notification.error("Error al fijar los grupos");
        }
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
            controller: function ($scope, $http, $uibModalInstance, Notification, data) {
                const vm = this;
                vm.data = data;
                vm.radioval = null;
    
                vm.cancel = function () {
                    $uibModalInstance.dismiss("cancel");
                };
    
                vm.accept = async function () {
                    try {
                        if (vm.radioval === "F") {
                            const response = await $http.post("session-finish-stages", 
                                { sesid: ActivityStateService.sessionDescriptor.id });
                            console.debug(response.data);
                        } else if (vm.radioval === "N") {
                            self.setTab("editor");
                            $uibModalInstance.dismiss("cancel");
                        }
                    } catch (error) {
                        console.error("Error processing request:", error);
                        Notification.error("There was an error processing your request.");
                    }
                };
            },
            controllerAs: "vm",
            scope: self,
            resolve: {
                data: () => ({})
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

    self.inputAssignedRoles = async () => {
        try {
            const response = await $http.post("get-assigned-jigsaw-roles", {
                sesid: ActivityStateService.sessionDescriptor.id
            });
            const data = response.data;
    
            data.forEach(d => {
                const user = self.users[d.userid];
                if (user) {
                    user.jigsaw = self.jroles.find(role => role.id === d.roleid);
                    user.jigsawId = d.roleid;
                }
            });
        } catch (error) {
            console.error("Error retrieving assigned jigsaw roles:", error);
        }
    };
    
    self.saveDraft = async () => {
        const data = {
            dfs: self.dfs,
            roles: self.roles,
            jroles: self.jroles,
        };
    
        const postdata = {
            sesid: ActivityStateService.sessionDescriptor.id,
            data: JSON.stringify(data),
        };
    
        try {
            await $http.post("save-draft", postdata);
            Notification.success("Datos guardados");
        } catch (error) {
            console.error("Error saving draft:", error);
            Notification.error("Error al guardar los datos");
        }
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
