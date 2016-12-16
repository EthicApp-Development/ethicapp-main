"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");

router.get("", (req, res) => {
    if (req.session.uid) {
        req.session.ses = req.query.sesid;
        res.redirect("visor");
    }
    else
        res.redirect(".");
});


let generateTeams = (alumArr, scFun, n) => {
    let arr = alumArr;
    arr.sort((a,b) => scFun(b) - scFun(a));
    let selected = Array.from(new Array(5)).map(x => false);
    let groups = [];
    let numGroups = alumArr.length / n;
    for(let i = 0 ; i < numGroups; i++){
        let rnd = [];
        let offset = arr.length / n;
        for(let j = 0; j < n; j++)
            rnd.push(Math.floor(Math.random()*offset) + offset*j);
        groups.push(arr.filter((a,i) => rnd.includes(Math.floor(i))));
        arr = arr.filter((a,i) => !rnd.includes(Math.floor(i)));
    }
    return groups;
};

module.exports = router;