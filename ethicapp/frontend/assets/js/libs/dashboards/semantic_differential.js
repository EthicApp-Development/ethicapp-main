export let buildSemanticDifferentialsTable = (data, users, dfs, gbu) => {
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
    
    let avg = (arr) => {
        return arr.length > 0 ? arr.reduce((v, e) => v + e, 0) / arr.length : 0;
    };
    
    let sdf = (arr) => {
        if (arr.length <= 1)
            return 0;
        let av = avg(arr);
        let sd = 0;
        arr.forEach(function (a) {
            sd += (a - av) * (a - av);
        });
        return Math.sqrt(sd / (arr.length - 1)) / av;
    };

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
