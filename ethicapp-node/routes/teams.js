"use strict";

let express = require("express");
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");
let socket = require("../modules/socket.config");


router.post("/get-team-selection",rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT DISTINCT s.answer,
        s.uid,
        s.qid,
        s.comment
    FROM selection AS s,
        questions AS q
    WHERE q.sesid = $1
        AND s.qid = q.id
        AND s.uid IN (
            SELECT tu.uid
            FROM teamusers AS tu
            WHERE tu.tmid = (
                SELECT t.id
                FROM teamusers AS tu,
                    teams AS t
                WHERE t.sesid = $2
                    AND tu.tmid = t.id
                    AND tu.uid = $3
            )
        )
        AND s.iteration = $4
    `,
    sesReqData:  ["ses","uid"],
    postReqData: ["iteration"],
    sqlParams:   [
        rpg.param("ses","ses"), rpg.param("ses","ses"), rpg.param("ses","uid"),
        rpg.param("post","iteration")
    ]
}));


router.post("/get-team-ideas",rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT i.id,
        i.uid,
        i.content,
        i.descr,
        i.serial,
        i.docid
    FROM ideas AS i
    INNER JOIN documents AS d
    ON i.docid = d.id
    WHERE d.sesid = $1
        AND i.uid in (
            SELECT tu.uid
            FROM teamusers AS tu
            WHERE tu.tmid = (
                SELECT t.id
                FROM teamusers AS tu,
                    teams AS t
                WHERE t.sesid = $2
                    AND tu.tmid = t.id
                    AND tu.uid = $3
            )
        )
        AND i.iteration = $4
    ORDER BY i.orden ASC
    `,
    sesReqData:  ["ses","uid"],
    postReqData: ["iteration"],
    sqlParams:   [
        rpg.param("ses","ses"), rpg.param("ses","ses"), rpg.param("ses","uid"),
        rpg.param("post","iteration")
    ]
}));


router.post("/get-team-semantic-units",rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT u.id,
        u.sentences,
        u.comment,
        u.docs,
        u.iteration,
        u.uid
    FROM semantic_unit AS u
    WHERE u.sesid = $1
        AND u.uid in (
            SELECT tu.uid
            FROM teamusers AS tu
            WHERE tu.tmid = (
                SELECT t.id
                FROM teamusers AS tu,
                    teams AS t
                WHERE t.sesid = $2
                    AND tu.tmid = t.id
                    AND tu.uid = $3
            )
        )
        AND u.iteration = $4
    ORDER BY u.uid ASC
    `,
    sesReqData:  ["ses","uid"],
    postReqData: ["iteration"],
    sqlParams:   [
        rpg.param("ses","ses"), rpg.param("ses","ses"), rpg.param("ses","uid"),
        rpg.param("post","iteration")
    ]
}));


router.post("/get-team-diff-selection",rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT DISTINCT s.sel,
        s.uid,
        s.did,
        s.comment
    FROM differential_selection AS s,
        differential AS d
    WHERE d.sesid = $1
        AND s.did = d.id
        AND s.uid in (
            SELECT tu.uid
            FROM teamusers AS tu
            WHERE tu.tmid = (
                SELECT t.id
                FROM teamusers AS tu,
                    teams AS t
                WHERE t.sesid = $2
                    AND tu.tmid = t.id
                    AND tu.uid = $3
            )
        )
        AND s.iteration = $4
    `,
    sesReqData:  ["ses","uid"],
    postReqData: ["iteration"],
    sqlParams:   [
        rpg.param("ses","ses"), rpg.param("ses","ses"), rpg.param("ses","uid"),
        rpg.param("post","iteration")
    ]
}));


router.post("/get-team-actor-selection",rpg.multiSQL({
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


router.post("/get-team-differential-selection",rpg.multiSQL({
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


router.post("/get-ses-info",rpg.singleSQL({
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


router.post("/get-team-leader",rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT leader,
        original_leader,
        id
    FROM teams
    INNER JOIN teamusers
    ON tmid = id
    WHERE UID = $1
        AND sesid = $2
    `,
    sesReqData: ["ses","uid"],
    sqlParams:  [rpg.param("ses","uid"), rpg.param("ses","ses")]
}));


router.post("/get-team-sync-ideas", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT i.id,
        i.content,
        i.descr,
        i.serial,
        i.docid
    FROM ideas AS i
    INNER JOIN documents AS d
    ON i.docid = d.id
    WHERE i.uid in (
        SELECT original_leader
        FROM teams
        INNER JOIN teamusers
        ON tmid = id
        WHERE UID = $1
            AND sesid = $2
    )
        AND d.sesid = $3
        AND i.iteration = 3
    ORDER BY i.orden ASC
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("ses", "uid"), rpg.param("ses", "ses"), rpg.param("ses", "ses")]
}));


router.post("/check-team-answer",rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT t.uid,
        s.answer,
        q.comment,
        q.answer AS realanswer
    FROM (
        SELECT UID
        FROM teamusers
        WHERE tmid in (
            SELECT tmid
            FROM teams
            INNER JOIN teamusers
            ON id = tmid
            WHERE UID = $1
            AND sesid = $2
        )
    ) AS t
    LEFT OUTER JOIN (
        SELECT UID,
            answer,
            qid
        FROM selection
        WHERE iteration = 3
        AND qid = $3
    ) AS s ON s.uid = t.uid
    LEFT OUTER JOIN questions AS q
    ON s.qid = q.id
    `,
    sesReqData:  ["ses","uid"],
    postReqData: ["qid"],
    sqlParams:   [rpg.param("ses","uid"), rpg.param("ses","ses"), rpg.param("post","qid")],
    onEnd:       (req,res,arr) => {
        let answered = true;
        let option = null;
        let sameOption = true;
        let real_ans = null;
        let real_comment = null;
        arr.forEach((row) => {
            answered = answered && row.answer != null;
            option = (option == null)? row.answer : option;
            sameOption = sameOption && row.answer == option;
            real_ans = row.realanswer;
            real_comment = row.comment;
        });
        if(!answered){
            res.end('{"status":"incomplete"}');
        }
        else if(!sameOption){
            res.end('{"status":"different"}');
        }
        else if(option != real_ans){
            res.end('{"status":"incorrect", "msg": "'+real_comment+'"}');
        }
        else{
            res.end('{"status":"ok"}');
        }
    }
}));


router.post("/get-team", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT u.name,
        u.id,
        t.progress,
        t.id AS tmid,
        u.id in (
            SELECT UID
            FROM finish_session
            WHERE status = 5
                AND sesid = $1
        ) AS finished
    FROM users AS u,
        teams AS t,
        teamusers AS tu
    WHERE tu.uid = u.id
        AND t.id = tu.tmid
        AND t.sesid = $2
        AND t.id in (
            SELECT tmid
            FROM teamusers
            WHERE UID = $3
        )
    ORDER BY u.id
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("ses", "ses"), rpg.param("ses", "ses"), rpg.param("ses", "uid")]
}));


router.post("/get-team-stage", rpg.multiSQL({
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


router.post("/get-anon-team", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT u.id,
        t.id AS tmid,
        u.id in (
            SELECT UID
            FROM finish_session
            WHERE status = 5
                AND sesid = $1
        ) AS finished
    FROM users AS u,
        teams AS t,
        teamusers AS tu
    WHERE tu.uid = u.id
        AND t.id = tu.tmid
        AND t.sesid = $2
        AND t.id in (
            SELECT tmid
            FROM teamusers
            WHERE UID = $3
        )
    ORDER BY u.id
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("ses", "ses"), rpg.param("ses", "ses"), rpg.param("ses", "uid")]
}));


router.post("/send-team-progress", rpg.execSQL({
    dbcon:       pass.dbcon,
    sql:         "update teams set progress = $1 where id = $2",
    sesReqData:  ["ses","uid"],
    postReqData: ["tmid","progress"],
    sqlParams:   [rpg.param("post","progress"),rpg.param("post","tmid")],
    onEnd:       (req) => {
        socket.teamProgress(req.session.ses, req.body.tmid);
    }
}));

router.post("/update-my-team", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id
    FROM teams
    INNER JOIN teamusers
    ON tmid = id
    WHERE UID = $1
        AND sesid = $2
    `,
    sesReqData: ["ses","uid"],
    sqlParams:  [rpg.param("ses","uid"), rpg.param("ses","ses")],
    onEnd:      (req,res,ans) => {
        socket.updateTeam(ans.id);
    }
}));


router.post("/take-team-control", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE teams
    SET leader = $1
    FROM teamusers
    WHERE tmid = id
        AND UID = $2
        AND sesid = $3
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("ses", "uid"), rpg.param("ses", "uid"), rpg.param("ses", "ses")]
}));


router.post("/get-original-leaders", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT t.original_leader AS leader,
        array_agg(tu.uid) AS team,
        t.id
    FROM teams AS t
    INNER JOIN teamusers AS tu
    ON t.id = tu.tmid
    WHERE t.sesid = $1
    GROUP BY t.original_leader, t.id
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-differential-all", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT tmid,
        iteration,
        orden,
        s.uid,
        s.did,
        sel,
        comment
    FROM differential_selection AS s
    INNER JOIN differential d
    ON s.did = d.id,
    teamusers AS tu,
    teams AS t
    WHERE tu.tmid = t.id
        AND tu.uid = s.uid
        AND t.sesid = d.sesid
        AND d.sesid = $1
    ORDER BY tmid,
        iteration,
        orden
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-differential-all-stage", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT d.stageid,
        d.orden,
        s.uid,
        r.tmid,
        s.did,
        s.sel,
        s.comment
    FROM differential_selection AS s
    INNER JOIN differential AS d
    ON s.did = d.id
    LEFT JOIN (
        SELECT tu.*
        FROM teamusers AS tu
        INNER JOIN teams AS t
        ON tu.tmid = t.id
            AND t.stageid = $1
    ) AS r
    ON r.uid = s.uid
    WHERE d.stageid = $2
    ORDER BY stageid,
        UID,
        orden
    `,
    postReqData: ["stageid"],
    sqlParams:   [rpg.param("post", "stageid"), rpg.param("post", "stageid")]
}));


router.post("/get-differential-indv", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.uid AS tmid,
        iteration,
        orden,
        s.uid,
        s.did,
        sel,
        comment
    FROM differential_selection AS s
    INNER JOIN differential d
    ON s.did = d.id
    WHERE d.sesid = $1
        AND iteration = 1
    ORDER BY tmid,
        orden
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-chat-count", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT c.did,
        u.tmid,
        d.orden,
        count(*)
    FROM differential_chat AS c
    INNER JOIN teamusers AS u
    ON u.uid = c.uid
    INNER JOIN differential AS d
    ON d.id = c.did
    INNER JOIN teams AS tm
    ON tm.id = u.tmid
    WHERE d.sesid = $1
        AND tm.sesid = $2
    GROUP BY c.did,
        u.tmid,
        d.orden
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid"), rpg.param("post", "sesid")]
}));


router.post("/get-dif-chat-count", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT c.did,
        u.uid,
        u.tmid,
        count(*)
    FROM differential_chat AS c
    INNER JOIN teamusers AS u
    ON u.uid = c.uid
    INNER JOIN differential AS d
    ON d.id = c.did
    INNER JOIN teams AS tm
    ON tm.id = u.tmid
    WHERE d.stageid = $1
        AND tm.stageid = $2
    GROUP BY c.did,
        u.uid,
        u.tmid
    `,
    postReqData: ["stageid"],
    sqlParams:   [rpg.param("post", "stageid"), rpg.param("post", "stageid")]
}));


router.post("/get-chat-count-stage", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT u.uid,
        u.tmid,
        count(*) AS count
    FROM chat AS c
    INNER JOIN teamusers AS u
    ON u.uid = c.uid
    INNER JOIN teams AS tm
    ON tm.id = u.tmid
    WHERE c.stageid = $1
    AND tm.stageid = $2
    GROUP BY u.uid,
        u.tmid
    `,
    postReqData: ["stageid"],
    sqlParams:   [rpg.param("post", "stageid"), rpg.param("post", "stageid")]
}));


module.exports = router;
