"use strict";

let express = require("express");
let router = express.Router();
let rpg = require("../db/rest-pg");
let pass = require("../config/keys-n-secrets");
let socket = require("../config/socket.config");

router.post("/get-stages", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        number,
        type,
        anon,
        chat,
        question,
        prev_ans
    FROM stages
    WHERE sesid = $1
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("ses", "ses")]
}));


router.post("/get-admin-stages", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        number,
        type,
        anon,
        chat,
        prev_ans,
        question,
        grouping
    FROM stages
    WHERE sesid = $1
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-current-stage", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT number
    FROM stages
    INNER JOIN sessions
    ON stages.id = sessions.current_stage
    WHERE sessions.id = $1
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/add-stage", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO stages (number, type, anon, chat, sesid, prev_ans, question, grouping)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
    `,
    postReqData: ["number", "type", "anon", "chat", "sesid"],
    sqlParams:   [
        rpg.param("post", "number"), rpg.param("post", "type"), rpg.param("post", "anon"),
        rpg.param("post", "chat"), rpg.param("post", "sesid"), rpg.param("post", "prev_ans"),
        rpg.param("post", "question"), rpg.param("post", "grouping")
    ]
}));


router.post("/add-actor", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO actors (name, jorder, stageid, justified, word_count)
    VALUES ($1, $2, $3, $4, $5)
    `,
    postReqData: ["name", "jorder", "stageid", "justified"],
    sqlParams:   [
        rpg.param("post", "name"), rpg.param("post", "jorder"), rpg.param("post", "stageid"),
        rpg.param("post", "justified"), rpg.param("post", "word_count")
    ]
}));


router.post("/get-actors", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        name,
        jorder,
        justified,
        word_count
    FROM actors
    WHERE stageid = $1
    `,
    postReqData: ["stageid"],
    sqlParams:   [rpg.param("post", "stageid")]
}));


router.post("/get-my-actor-sel", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        description,
        orden,
        actorid
    FROM actor_selection
    WHERE stageid = $1
        AND UID = $2
    ORDER BY orden
    `,
    sesReqData:  ["ses","uid"],
    postReqData: ["stageid"],
    sqlParams:   [rpg.param("post", "stageid"), rpg.param("ses", "uid")]
}));

router.post("/get-role-sel-all", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        description,
        orden,
        actorid,
        UID
    FROM actor_selection
    WHERE stageid = $1
    ORDER BY UID, orden
    `,
    sesReqData:  ["uid"],
    postReqData: ["stageid"],
    sqlParams:   [rpg.param("post", "stageid")]
}));

router.post("/session-start-stage", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE sessions
    SET status = 2,
        current_stage = $1
    WHERE id = $2
    `,
    sesReqData:  ["uid"],
    postReqData: ["stageid", "sesid"],
    sqlParams:   [rpg.param("post", "stageid"), rpg.param("post", "sesid")],
    onEnd:       (req,res) => {
        res.send('{"status":"ok"}');
        socket.stateChange(req.body.sesid);
    }
}));

router.post("/session-finish-stages", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE sessions
    SET status = 3,
        current_stage = NULL
    WHERE id = $1
    `,
    sesReqData:  ["uid"],
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")],
    onEnd:       (req,res) => {
        res.send('{"status":"ok"}');
        socket.stateChange(req.body.sesid);
    }
}));

router.post("/send-actor-selection", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    WITH ROWS AS (
        UPDATE actor_selection
        SET orden = $1,
            description = $2,
            stime = now()
        WHERE actorid = $3
            AND UID = $4
            AND stageid = $5
        RETURNING 1
    )
    INSERT INTO actor_selection(UID, actorid, orden, description, stageid, stime)
    SELECT $6,
        $7,
        $8,
        $9,
        $10,
        now()
    WHERE 1 NOT IN (
        SELECT *
        FROM ROWS
    )
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["actorid", "orden", "stageid"],
    sqlParams:   [
        rpg.param("post", "orden"), rpg.param("post", "description"), rpg.param("post", "actorid"),
        rpg.param("ses", "uid"), rpg.param("post", "stageid"), rpg.param("ses", "uid"),
        rpg.param("post", "actorid"), rpg.param("post", "orden"), rpg.param("post", "description"),
        rpg.param("post", "stageid")
    ]
}));


router.post("/add-jigsaw-role", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO jigsaw_role (name, description, sesid)
    VALUES ($1, $2, $3)
    `,
    postReqData: ["name", "description", "sesid"],
    sqlParams:   [
        rpg.param("post", "name"), rpg.param("post", "description"), rpg.param("post", "sesid")
    ]
}));


router.post("/get-jigsaw-roles", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        name,
        description
    FROM jigsaw_role
    WHERE sesid = $1
    ORDER BY id
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-my-jigsaw-roles", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        name,
        description
    FROM jigsaw_role
    WHERE sesid = $1
    ORDER BY id
    `,
    sesReqData: ["ses"],
    sqlParams:  [rpg.param("ses", "ses")]
}));


router.post("/assign-jigsaw-role", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO jigsaw_users (stageid, userid, roleid)
    VALUES ($1, $2, $3)
    `,
    postReqData: ["stageid", "userid", "roleid"],
    sqlParams:   [
        rpg.param("post", "stageid"), rpg.param("post", "userid"), rpg.param("post", "roleid")
    ]
}));


router.post("/get-assigned-jigsaw-role", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT ju.roleid,
        ju.stageid
    FROM jigsaw_users AS ju,
        jigsaw_role AS j
    WHERE ju.roleid = j.id
        AND j.sesid = $1
        AND ju.userid = $2
    ORDER BY ju.stageid DESC
    `,
    sesReqData: ["ses", "uid"],
    sqlParams:  [rpg.param("ses", "ses"), rpg.param("ses", "uid")]
}));

router.post("/assign-cyclic-jigsaw-role", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    WITH ROWS AS (
        SELECT row_number() OVER () AS n, (
            SELECT count(*) % $1 + 1 AS cnum
            FROM jigsaw_users
            WHERE stageid = $2
        ) AS cnum,
        id
        FROM jigsaw_role
        WHERE sesid = $3
    )
    INSERT INTO jigsaw_users (stageid, userid, roleid)
    SELECT $4,
        $5,
        id
    FROM ROWS
    WHERE n = cnum
    `,
    postReqData: ["cycle", "stageid"],
    sesReqData:  ["ses", "uid"],
    sqlParams:   [
        rpg.param("post", "cycle"), rpg.param("post", "stageid"), rpg.param("ses", "ses"),
        rpg.param("post", "stageid"), rpg.param("ses", "uid")
    ]
}));

router.post("/get-assigned-jigsaw-roles", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT ju.userid,
        ju.roleid
    FROM jigsaw_users AS ju,
        jigsaw_role AS j
    WHERE ju.roleid = j.id
        AND j.sesid = $1
    ORDER BY ju.stageid ASC
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-draft", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        DATA
    FROM drafts
    WHERE sesid = $1
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/save-draft", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    WITH ROWS AS (
        UPDATE drafts
        SET DATA = $1
        WHERE sesid = $2
        RETURNING 1
    )
    INSERT INTO drafts(DATA, sesid)
    SELECT $3,
        $4
    WHERE 1 not in (
        SELECT *
        FROM ROWS
    )
    `,
    postReqData: ["sesid", "data"],
    sqlParams:   [
        rpg.param("post", "data"), rpg.param("post", "sesid"), rpg.param("post", "data"),
        rpg.param("post", "sesid")
    ]
}));


module.exports = router;
