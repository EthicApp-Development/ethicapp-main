export let computeRankingFrequencyTable = (data, actors) => {
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

//  Turns a permutation given by arr into its Lehmer code, using acts as the reference permutation.
export let lehmerCode = (arr, acts) => {
    // p contains actors' ids
    let p = acts.map(e => e.id);
    // perm is an exact copy of acts
    let perm = arr.map(e => e);

    let n = p.length; // acts length

    // key: element value, value: position in array p
    // This structure facilitates finding the position of an element in array p 
    let pos_map = {};
    p.forEach((e, i) => {
        pos_map[e] = i;
    });

    // w starts as an empty list that will be filled up with Lehmer code values
    let w = [];

    // traverse perm and compute the difference among an element in perm and in p. Add the
    // difference to w. 
    for (let i = 0; i < n; i++) {
        let d = pos_map[perm[i]] - i;
        w.push(d);
        if (d == 0)
            // nothing to be done if there is no difference, as the
            // element is in its proper position.
            continue;

        // if the element is not fitted in its proper position, swap elements in p and update
        // pos_map accordingly
        let t = pos_map[perm[i]];

        let tmp = pos_map[p[t]];
        pos_map[p[t]] = pos_map[p[i]];
        pos_map[p[i]] = tmp;

        tmp = p[t];
        p[t] = p[i];
        p[i] = tmp;
    }

    // w contains Lehmer's permutation code
    return w;
}

export let lehmerNum = (code) => {
    let n = 0;
    for (let i = 0; i < code.length; i++) {
        let v = code[code.length - i - 1];
        n *= i;
        n += v;
    }
    return n;
}

export let simpleNum = (code) => {
    let n = 0;
    for (let i = 0; i < code.length; i++) {
        let v = code[code.length - i - 1];
        n *= code.length;
        n += v;
    }
    return n;
}

export let computeIndTable = (data, actors) => {
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

export let sortIndTable = (table, users) => {
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
