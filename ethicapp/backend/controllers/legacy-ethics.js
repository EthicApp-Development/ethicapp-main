"use strict";

import express from "express";
import pass from "../helpers/compat-helper.js"; 
import * as rpg from "../db/rest-pg.js";
import * as config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";
import { studentNotifications } from "../config/socket.config.js";
import * as ViewsHelper from "../helpers/views-helper.js";

const router = express.Router();

// Endpoints required by Semantic Differential designs
router.get("/ethics", (req, res) => {
    if (req.session.uid && req.session.ses)
        res.render("ethics", {
            layout: "./layouts/student-app",
            title: "EthicApp",
            ngApp: "StudentEthics",
            controller:  "EthicsController",
            scripts:    [
                ["libs/angular-glue.min.js"],
                ["js/dist/ethics.js", "js/dist/ethics.min.js"]
            ],
            renderScripts: (scripts) => ViewsHelper.renderScripts(scripts, res)            
        });
    else
        res.redirect(".");
});

router.get("/to-diff", (req, res) => {
    if (req.session.uid) {
        req.session.ses = req.query.sesid;
        req.session.save((err) => {
            if (err) {
                res.redirect(".");
            }
            else {
                res.redirect("ethics");
            }
        });
    }
    else {
        res.redirect(".");
    }
});

router.post("/get-ses-info", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT greatest(-1, least(7, s.status-2)) AS iteration,
        $1::int AS UID,
        s.name,
        s.id,
        s.descr,
        s.options,
        s.type,
        sr.stime,
        s.current_stage
    FROM sessions AS s
    LEFT OUTER JOIN status_record AS sr
    ON sr.sesid = s.id
        AND s.status = sr.status
    WHERE s.id = $2
    `,
    sesReqData: ["ses","uid"],
    sqlParams:  [rpg.param("ses","uid"), rpg.param("ses","ses")]
}));

router.post("/get-design-by-sesid", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT a.design
    FROM activity AS a
    WHERE a.session = $1
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));

router.post("/get-diff-chat-stage", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.id,
        s.did,
        s.uid,
        s.content,
        s.stime,
        s.parent_id
    FROM differential_chat AS s
    INNER JOIN differential AS d
    ON d.id = s.did
    WHERE d.stageid = $1
        AND s.uid in (
            SELECT tu.uid
            FROM teamusers AS tu
            WHERE tu.tmid = (
                SELECT t.id
                FROM teamusers AS tu,
                    teams AS t
                WHERE t.stageid = $2
                    AND tu.tmid = t.id
                    AND tu.uid = $3
            )
        )
    ORDER BY s.stime ASC
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["stageid"],
    sqlParams:   [
        rpg.param("post", "stageid"), rpg.param("post","stageid"), rpg.param("ses", "uid")
    ]
}));

router.post("/get-diff-selection-stage", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.did,
        s.sel,
        s.comment
    FROM differential_selection AS s
    INNER JOIN differential AS d
    ON d.id = s.did
    WHERE d.stageid = $1
        AND s.uid = $2
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["stageid"],
    sqlParams:   [rpg.param("post", "stageid"), rpg.param("ses", "uid")]
}));

router.post("/get-stages", await rpg.multiSQL({
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

router.post("/get-team-stage", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT u.name,
        u.id,
        t.progress,
        t.id AS tmid
    FROM users AS u,
        teams AS t,
        teamusers AS tu
    WHERE tu.uid = u.id
        AND t.id = tu.tmid
        AND t.stageid = $1
        AND t.id in (
            SELECT tmid
            FROM teamusers
            WHERE UID = $2
        )
    ORDER BY u.id
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("post", "stageid"), rpg.param("ses", "uid")]
}));

router.post("/get-team-differential-selection-deprecated", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT DISTINCT s.sel,
        s.uid,
        s.did,
        s.comment,
        d.stageid,
        d.orden,
        d.title,
        d.tleft,
        d.tright,
        d.num
    FROM differential_selection AS s,
        differential AS d
    WHERE d.stageid = ANY ($1)
        AND s.uid in (
            SELECT tu.uid
            FROM teamusers AS tu
            WHERE tu.tmid = (
                SELECT t.id
                FROM teamusers AS tu,
                    teams AS t
                WHERE t.stageid = $2
                    AND tu.tmid = t.id
                    AND tu.uid = $3
            )
        )
        AND s.did = d.id
    ORDER BY d.stageid,
            s.uid,
            d.orden
    `,
    sesReqData:  ["ses","uid"],
    postReqData: ["prevstages", "stageid"],
    onStart:     (ses, data, calc) => {
        calc.prevarr = data.prevstages.split(",").map(e => +e);
    },
    sqlParams: [rpg.param("calc","prevarr"), rpg.param("post","stageid"), rpg.param("ses","uid")]
}));

router.post("/get-team-differential-selection", async (req, res) => {
    const { stageid, prevstages } = req.body;
    let prevStagesArray = JSON.parse(prevstages);

    // Validate input
    if (!Array.isArray(prevStagesArray) || !prevStagesArray.every(Number.isInteger)) {
        return res.status(400).json({ error: "Invalid 'prevstages' parameter. Must be an array of integers." });
    }

    if (!Number.isInteger(stageid)) {
        return res.status(400).json({ error: "Invalid 'stageid' parameter. Must be an integer." });
    }

    try {
        const db = await rpg2.getDBInstance(config.dbconnString);

        // Query with subquery to map phase numbers to stage IDs
        const sql = `
            SELECT DISTINCT s.sel,
                s.uid,
                s.did,
                s.comment,
                d.stageid,
                d.orden,
                d.title,
                d.tleft,
                d.tright,
                d.num
            FROM differential_selection AS s
            INNER JOIN differential AS d
                ON s.did = d.id
            WHERE d.stageid = ANY (
                SELECT id
                FROM stages
                WHERE sesid = (
                    SELECT sesid
                    FROM stages
                    WHERE id = $1
                )
                AND number = ANY($2::int[])
            )
            AND s.uid IN (
                SELECT tu.uid
                FROM teamusers AS tu
                WHERE tu.tmid = (
                    SELECT t.id
                    FROM teamusers AS tu
                    INNER JOIN teams AS t
                        ON tu.tmid = t.id
                    WHERE t.stageid = $1
                        AND tu.uid = $3
                )
            )
            ORDER BY d.stageid, s.uid, d.orden
        `;

        const result = await db.query(sql, [stageid, prevStagesArray, req.session.uid]);

        res.status(200).json({ data: result.rows });
    } catch (error) {
        console.error("Error in /get-team-differential-selection:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/get-differentials-stage", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT *
    FROM differential
    WHERE stageid = $1
    ORDER BY orden
    `,
    postReqData: ["stageid"],
    sesReqData:  ["uid"],
    sqlParams:   [rpg.param("post", "stageid")]
}));

router.post("/send-diff-selection", async (req, res, next) => {
    
    if (isContentAnalysisAvailable()){
        initializeContentAnalysis(req, res);
    }    

    return await rpg.execSQL({
        dbcon: pass.dbcon,
        sql: `
            WITH ROWS AS (
                UPDATE differential_selection
                SET sel = $1,
                    comment = $2,
                    stime = now()
                WHERE did = $3
                    AND UID = $4
                    AND iteration = $5
                RETURNING 1
            )
            INSERT INTO differential_selection(UID, did, sel, comment, iteration, stime)
            SELECT $6,
                $7,
                $8,
                $9,
                $10,
                now()
            WHERE 1 not in (
                SELECT *
                FROM ROWS
            )
        `,
        sesReqData: ["uid", "ses"],
        postReqData: ["did", "sel", "comment", "iteration"],
        sqlParams: [
            rpg.param("post", "sel"), rpg.param("post", "comment"), rpg.param("post", "did"),
            rpg.param("ses", "uid"), rpg.param("post", "iteration"), rpg.param("ses", "uid"),
            rpg.param("post", "did"), rpg.param("post", "sel"), rpg.param("post", "comment"),
            rpg.param("post", "iteration")
        ]
    })(req, res, next);
});

router.post("/add-chat-msg", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO differential_chat(UID, did, content, parent_id)
    VALUES ($1,$2,$3,$4)
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["did", "content", "tmid"],
    sqlParams:   [
        rpg.param("ses", "uid"), rpg.param("post", "did"), rpg.param("post","content"),
        rpg.param("post","parent_id")
    ],
    onEnd: (req) => {
        studentNotifications.chatMessage(req.body.tmid, "");
        //socket.chatMsg(req.session.ses, req.body.tmid);
    }
}));

// Endpoints required by Ranking designs
router.post("/get-my-jigsaw-roles", await rpg.multiSQL({
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

router.post("/get-assigned-jigsaw-role", await rpg.multiSQL({
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

router.post("/get-assigned-jigsaw-roles", await rpg.multiSQL({
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

router.post("/assign-cyclic-jigsaw-role", await rpg.execSQL({
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

router.post("/get-team-actor-selection", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT DISTINCT s.orden,
        s.uid,
        s.actorid,
        s.description,
        s.stageid,
        a.name
    FROM actor_selection AS s,
        actors AS a
    WHERE s.stageid = ANY ($1)
        AND s.uid in (
            SELECT tu.uid
            FROM teamusers AS tu
            WHERE tu.tmid = (
                SELECT t.id
                FROM teamusers AS tu,
                    teams AS t
                WHERE t.stageid = $2
                    AND tu.tmid = t.id
                    AND tu.uid = $3
            )
        )
        AND s.actorid = a.id
    ORDER BY s.stageid,
            s.uid,
            s.orden
    `,
    sesReqData:  ["ses","uid"],
    postReqData: ["prevstages", "stageid"],
    onStart:     (ses, data, calc) => {
        calc.prevarr = data.prevstages.split(",").map(e => +e);
    },
    sqlParams: [rpg.param("calc","prevarr"), rpg.param("post","stageid"), rpg.param("ses","uid")]
}));

router.post("/get-actors", await rpg.multiSQL({
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

router.post("/get-my-actor-sel", await rpg.multiSQL({
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

router.post("/get-team-stage", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT u.name,
        u.id,
        t.progress,
        t.id AS tmid
    FROM users AS u,
        teams AS t,
        teamusers AS tu
    WHERE tu.uid = u.id
        AND t.id = tu.tmid
        AND t.stageid = $1
        AND t.id in (
            SELECT tmid
            FROM teamusers
            WHERE UID = $2
        )
    ORDER BY u.id
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("post", "stageid"), rpg.param("ses", "uid")]
}));

router.post("/get-chat-stage", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.id,
        s.uid,
        s.content,
        s.stime,
        s.parent_id,
        s.stageid
    FROM chat AS s
    WHERE s.stageid = $1
        AND s.uid in (
            SELECT tu.uid
            FROM teamusers AS tu
            WHERE tu.tmid = (
                SELECT t.id
                FROM teamusers AS tu,
                    teams AS t
                WHERE t.stageid = $2
                    AND tu.tmid = t.id
                    AND tu.uid = $3
            )
        )
    ORDER BY s.stime ASC
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["stageid"],
    sqlParams:   [
        rpg.param("post", "stageid"), rpg.param("post","stageid"), rpg.param("ses", "uid")
    ]
}));

router.post("/send-actor-selection", await rpg.execSQL({
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

router.post("/send-actor-selection", await rpg.execSQL({
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

export default router;