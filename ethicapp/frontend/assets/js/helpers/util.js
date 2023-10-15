/*eslint func-style: ["error", "expression"]*/
export let generateTeams = (alumArr, scFun, n, different, double) => {
    if (n == null || n == 0) return [];
    var arr = alumArr;
    if(!double) {
        arr.sort(function (a, b) {
            return scFun(b) - scFun(a);
        });
    }
    else{
        arr.sort(scFun);
    }
    var groups = [];
    var numGroups = alumArr.length / n;
    for (var i = 0; i < numGroups; i++) {
        if (different) {
            (function () {
                var rnd = [];
                var offset = arr.length / n;
                for (var j = 0; j < n; j++) {
                    rnd.push(~~(Math.random() * offset + offset * j));
                }
                groups.push(arr.filter(function (a, i) {
                    return rnd.includes(i);
                }));
                arr = arr.filter(function (a, i) {
                    return !rnd.includes(i);
                });
            })();
        } else {
            groups.push(arr.filter(function (a, i) {
                return i < n;
            }));
            arr = arr.filter(function (a, i) {
                return i >= n;
            });
        }
    }
    var final_groups = [];
    var ov = 0;
    for (var _i = 0; _i < groups.length; _i++) {
        if (groups[_i].length > 1 || final_groups.length == 0) {
            final_groups.push(groups[_i]);
        }
        else {
            final_groups[ov % final_groups.length].push(groups[_i][0]);
            ov++;
        }
    }
    return final_groups;
};

export let isDifferent = (type) => {
    switch (type) {
    case "performance homog":
        return false;
    case "performance heterg":
        return true;
    case "knowledgeType homog":
        return false;
    case "knowledgeType heterg":
        return true;
    }
    return false;
};

export let habMetric = (u) => {
    switch (u.aprendizaje) {
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

export let ngQuillConfigProvider = (ngQuillConfigProvider) => {
    ngQuillConfigProvider.set({
        modules: {
            formula: true,
            toolbar: {
                container: [["bold", "italic", "underline", "strike"], // toggled buttons
                    [{ "color": [] }, { "background": [] }], // dropdown with defaults from theme
                    [{ "font": [] }], [{ "align": [] }],
                    [{ "list": "ordered" }, { "list": "bullet" }],
                    [{ "script": "sub" }, { "script": "super" }], // superscript/subscript
                    [{ "size": ["small", false, "large", "huge"] }], // custom dropdown
                    ["clean"], // remove formatting button
                    ["image", "link", "video"], // remove formatting button
                    ["formula"]
                ]
            }
        }
    });
};