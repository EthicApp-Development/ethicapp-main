"use strict";

import express from "express";
import pass from "../helpers/compat-helper.js"; 
import * as config from "../config/config.js"; 
import * as rpg from "../db/rest-pg.js";
import * as rpg2 from "../db/rest-pg-2.js";
import * as ViewsHelper from "../helpers/views-helper.js";
import { teacherNotifications } from "../config/socket.config.js";

const router = express.Router();

router.get("/seslist", (req, res) => {
    if (req.session.uid) {
        if (req.session.role == "P") {
            res.redirect("/home");
        }
        else {
            res.render("seslist", {
                title:        "EthicApp",
                ngApp:        "SessionsList",
                controller:   "SessionsListController",
                scripts:    [
                    ["js/dist/sessions.js", "js/dist/sessions.min.js"]
                ],
                renderScripts: (scripts) => ViewsHelper.renderScripts(scripts, res)
            });
        }
    }
    else {
        console.warn("No user id in session.");
        res.redirect(".");
    }
});

router.post("/get-session-list", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT *
    FROM (
        SELECT DISTINCT s.id,
            s.name,
            s.descr,
            s.status,
            s.type,
            s.time,
            s.code,
            s.options,
            s.archived,
            s.current_stage,
            s.additional_config,
            (
                s.id in (SELECT sesid FROM teams)
            ) AS grouped,
            (
                SELECT count(*)
                FROM report_pair
                WHERE sesid = s.id
            ) AS paired,
            sr.stime
        FROM sessions AS s
        LEFT OUTER JOIN status_record AS sr
        ON sr.sesid = s.id
            AND s.status = sr.status,
        sesusers AS su,
        users AS u
        WHERE su.uid = $1
            AND (OPTIONS like 'X%') IS NOT TRUE
            AND u.id = su.uid
            AND su.sesid = s.id
    ) AS v
    ORDER BY v.time DESC
    `,
    sesReqData: ["uid"],
    sqlParams:  [rpg.param("ses", "uid")]
}));


router.post("/add-session", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    WITH ROWS AS (
        INSERT INTO sessions(name, descr, creator, TIME, status, TYPE)
        VALUES ($1,
            $2,
            $3,
            now(),
            1,
            $4
        ) RETURNING id
    )
    INSERT INTO sesusers(sesid, UID)
    SELECT id,
        $5
    FROM ROWS;

    SELECT UpdateOrInsertActivityRecord($3)
    `,
    sesReqData:  ["uid"],
    postReqData: ["name", "type"],
    sqlParams:   [
        rpg.param("post", "name"), rpg.param("post", "descr"), rpg.param("ses", "uid"),
        rpg.param("post","type"), rpg.param("ses", "uid")
    ],
    onStart: (ses) => {
        if (ses.role != "P") {
            console.warn("Sólo profesor puede crear sesiones");
            console.warn(ses);
            return "SELECT $1, $2, $3, $4, $5";
        }
    },
    onEnd: (req, res) => {
        res.redirect("admin");
    }
}));

router.post("/sessions", async (req, res) => {
    const uid = req.session.uid;
    const { name, description, type, additionalConfig } = req.body;
    const config = additionalConfig || {};

    console.debug(`POST /sessions: ${name}, ${description}, ${type}, ${additionalConfig}`);

    try {
        // Step 1: Insert into `sessions` table and get the id returned.
        const sessionResult = await rpg2.singleSQL({
            dbcon: pass.dbcon,
            sql:   `
                INSERT INTO sessions(name, descr, creator, time, status, type)
                VALUES ($1, $2, $3, now(), 1, $4)
                RETURNING id;
            `,
            sqlParams: [rpg2.param('plain', name), 
                        rpg2.param('plain', description), 
                        rpg2.param('plain', uid), 
                        rpg2.param('plain', type)]
        });
        
        const sessionId = sessionResult.id;

        if (!sessionId) {
            console.error("[sessions] sessionId not found");
            throw new Error("Failed to retrieve session ID");
        }

        // Step 2: Insert into `sesusers` table with the obtained session ID.
        await rpg2.singleSQL({
            dbcon: pass.dbcon,
            sql:   `
                INSERT INTO sesusers(sesid, uid)
                VALUES ($1, $2);
            `,
            sqlParams: [rpg2.param('plain', sessionId), 
                rpg2.param('plain', uid)]
        });

        // Step 3: Get the highest ID for the current creator.
        const maxIdResult = await rpg2.singleSQL({
            dbcon: pass.dbcon,
            sql:   `
                SELECT max(id) AS max FROM sessions WHERE creator = $1;
            `,
            sqlParams: [rpg2.param('plain', uid)]
        });

        const maxId = maxIdResult.max;

        // Generate a successful response.
        res.json({ status: 200, id: maxId });

    } catch (err) {
        console.error("Error in SQL query while creating a session:", err);
        res.status(400).json({ status: 400, message: "Error creating session" });
    }
});

router.post("/add-activity", async (req, res) => {
    const sesid = req.body.sesid;
    const dsgnid = req.body.dsgnid;

    try {
        // Insert into ACTIVITY table
        await rpg2.singleSQL({
            dbcon: pass.dbcon,
            sql:   `
                INSERT INTO ACTIVITY (design, SESSION)
                VALUES ($1, $2)
            `,
            sqlParams: [
                rpg2.param('plain', dsgnid), 
                rpg2.param('plain', sesid)]
        });

        // Update the designs table to lock the design
        await rpg2.singleSQL({
            dbcon: pass.dbcon,
            sql:   `
                UPDATE designs
                SET locked = TRUE
                WHERE id = $1
            `,
            sqlParams: [rpg2.param('plain', dsgnid)]
        });

        // Select the updated design to return as the result
        const result = await rpg2.singleSQL({
            dbcon: pass.dbcon,
            sql:   `
                SELECT design
                FROM DESIGNS
                WHERE id = $1
            `,
            sqlParams: [rpg2.param('plain', dsgnid)]
        });
        
        res.status(200).json({ status: 'ok', result: result.design });
    } catch (error) {
        console.error("Error in /add-activity endpoint:", error);
        res.status(400).json({ status: 400, error: "Error processing activity addition" });
    }
});

/**
 * @route GET /sessions/:id/users
 * @description Retrieves a list of users in a session. Validates that the requesting user is 
 *              the creator of the session and has the role of "P" (teacher/professor).
 * @param {string} id - The ID of the session (from the URL path).
 * @returns {Object} - A JSON object containing a list of users in the session.
 */
router.get("/sessions/:id/users", async (req, res) => {
    const { id } = req.params; // Session ID
    const { uid } = req.session; // User ID from session

    // Validate required parameters
    if (!id || !uid) {
        return res.status(400).json({ error: "Missing required parameters: session id or user id." });
    }

    try {
        // Verify the requesting user is the creator of the session and has the role of "P"
        const validationResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT u.role
                FROM users AS u
                INNER JOIN sessions AS s
                    ON s.creator = u.id
                WHERE s.id = $1
                  AND u.id = $2
                  AND u.role = 'P'
            `,
            sqlParams: [id, uid],
        });

        if (validationResult.length === 0) {
            return res.status(403).json({ error: "Access denied. User is not authorized for this session." });
        }

        // Retrieve the users in the session
        const users = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT u.id,
                       u.name,
                       u.mail,
                       u.aprendizaje,
                       u.role,
                       su.device
                FROM users AS u
                INNER JOIN sesusers AS su
                    ON u.id = su.uid
                WHERE su.sesid = $1
                ORDER BY u.role DESC
            `,
            sqlParams: [id],
        });

        // Check if any users were found
        if (users.length === 0) {
            return res.status(404).json({ error: "No users found for the given session." });
        }

        // Respond with the list of users
        res.status(200).json({ users });
    } catch (err) {
        console.error("Error fetching users for session:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/sessions/join/:code", async (req, res) => {
    const dbcon = pass.dbcon;
    const { code } = req.params;
    const { device } = req.body;
    const { uid } = req.session;

    if (!code || !device || !uid) {
        return res.status(400).json({ status: "error", message: "Missing required parameters." });
    }

    try {
        // Insertar al usuario en la sesión si las condiciones se cumplen
        const insertResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                INSERT INTO sesusers(UID, sesid, device)
                SELECT $1::int AS UID,
                       id,
                       $2 AS device
                FROM sessions
                WHERE code = $3
                  AND NOT EXISTS (
                      SELECT su.sesid
                      FROM sesusers AS su,
                           sessions AS s
                      WHERE su.uid = $1
                        AND s.code = $3
                        AND su.sesid = s.id
                  )
                  AND NOT EXISTS (
                      SELECT st.id
                      FROM stages AS st,
                           sessions AS ss
                      WHERE st.sesid = ss.id
                        AND ss.code = $3
                        AND st.type = 'team'
                  )
                RETURNING sesid
            `,
            sqlParams: [rpg2.param('plain', uid), rpg2.param('plain', device), 
                rpg2.param('plain', code)],
        });

        if (insertResult.length === 0 || !insertResult[0].sesid) {
            return res.status(400).json({ status: "end" });
        }

        const sesid = insertResult[0].sesid;

        // Obtener información del usuario
        const userResult = await rpg2.execSQL({
            dbcon,
            sql: `
                SELECT name, $1 AS device, role, mail
                FROM users
                WHERE id = $2
            `,
            sqlParams: [rpg2.param('plain', device), rpg2.param('plain', uid)]
        });

        if (userResult.length === 0) {
            return res.status(404).json({ status: "error", message: "User not found." });
        }

        const { name, role, mail } = userResult[0];

        teacherNotifications.studentJoined(sesid, { 
            id: uid,
            name,
            device,
            role,
            mail
        });

        const sessionResult = await rpg2.execSQL({
            dbcon,
            sql: `
                SELECT type
                FROM sessions
                WHERE id = $1
            `,
            sqlParams: [rpg2.param('plain', sesid)],
        });

        if (sessionResult.length === 0 || !sessionResult[0].type) {
            return res.status(400).json({ status: "end" });
        }

        const sessionType = sessionResult[0].type;
        req.session.ses = sesid;

        const redirectUrl =
            sessionType === "R" || sessionType === "J"
                ? "role-playing"
                : sessionType === "T"
                ? "ethics"
                : "select";

        return res.json({ status: "ok", redirect: redirectUrl, sesid });
    } catch (err) {
        console.error("Error joining session:", err);
        return res.status(500).json({ status: "error", message: "Internal server error." });
    }
});
    
router.post("/check-design", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
        SELECT design
        FROM DESIGNS
        WHERE id = $1;
    `,
    sqlParams: [rpg.param("body", "dsgnid")],
    onEnd:     (req, res, result) => {
        console.log(`[check design] ${JSON.stringify(result)}`);

        if (!result || !result.design) {
            return res.status(404).json({ status: "err", message: "Design not found" });
        }

        const design = result.design;
        let isValid = true;

        design.phases?.forEach(phase => {
            if (design.type === "semantic_differential") {
                phase.questions?.forEach(question => {
                    if (
                        !question.q_text ||
                        !question.ans_format.l_pole ||
                        !question.ans_format.r_pole
                    ) {
                        isValid = false;
                    }
                });
            } else if (design.type === "ranking") {
                if (!phase.q_text) {
                    isValid = false;
                }
                phase.roles?.forEach(role => {
                    if (!role.name) {
                        isValid = false;
                    }
                });
            }
        });

        res.json({ status: 200, result: isValid });
    },
    onError: (err, req, res) => {
        console.error("Error in /check-design query:", err);
        res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
}));

router.post("/get-activities", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
        SELECT activity.id,
            activity.session,
            sessions.creator,
            sessions.name,
            sessions.descr,
            sessions.time,
            sessions.code,
            sessions.archived,
            designs.design,
            sessions.status,
            sessions.type,
            designs.id AS dsgnid
        FROM activity
        INNER JOIN sessions
            ON activity.session = sessions.id
        INNER JOIN designs
            ON activity.design = designs.id
        WHERE sessions.creator = $1;
    `,
    sesReqData: ["uid"],
    sqlParams:  [rpg.param("ses", "uid")],
    onEnd:      async (req, res, result) => {
        res.json({ status: 200, activities: result });
    },
    onError: async (err, req, res) => {
        console.error("Error in /get-activities query:", err);
        res.status(400).json({ status: 400, error: "Error retrieving activities." });
    }
}));

router.get("/admin", (req, res) => {
    if (req.session.role == "P")
        res.render("admin");
    else
        res.redirect(".");
});

router.get("/home", function(req, res) {
    if (req.session.role == "P")
        try {
            console.log("Attempting to render /home.");
            res.render("home", {
                layout:     "./layouts/teacher-app",
                ngApp:      "TeacherApp",
                scripts:    [
                    ["libs/angular-glue.min.js"],
                    ["js/dist/teacher-admin.js", "js/dist/teacher-admin.min.js"],
                    ["libs/save-csv.min.js"]
                ],
                renderScripts: (scripts) => ViewsHelper.renderScripts(scripts, res),
                recaptchaEnabled: String(process.env.RECAPTCHA_ENABLED || "false").toLowerCase() === "true",
                recaptchaSiteKey: process.env.VITE_RECAPTCHA_SITE_KEY || ""
            });        
        } catch (error) {
            console.error(error);
            return res.status(500);
        }
    else {
        res.redirect(".");
    }
});

router.post("/update-session", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE sessions
    SET name = $1,
        descr = $2
    WHERE id = $3
    `,
    sesReqData: ["name", "descr", "id"],
    sqlParams:  [
        rpg.param("post", "name"), rpg.param("post", "descr"), rpg.param("post", "id")
    ]
}));


router.post("/upload-file", async (req, res) => {
    if (
        req.session.uid != null && req.body.title != null && req.body.title != "" &&
        req.files.pdf != null && req.files.pdf.mimetype == "application/pdf" &&
        req.body.sesid != null
    ) {
        await rpg.execSQL({
            dbcon: pass.dbcon,
            sql:   `
            INSERT INTO documents(title, PATH, sesid, uploader)
            VALUES ($1,$2,$3,$4)
            `,
            sqlParams: [
                rpg.param("post", "title"), rpg.param("calc", "path"),
                rpg.param("post", "sesid"), rpg.param("ses", "uid")
            ],
            onStart: (ses, data, calc) => {
                calc.path = "uploads" + req.files.pdf.file.split("uploads")[1];
            },
            onEnd: () => {
            }
        })(req, res);
        res.end('{"status":"ok"}');
    }
    res.end('{"status":"err"}');
});


router.post("/upload-design-file", async (req, res) => {
    if (
        req.session.uid != null  && req.files.pdf != null
        && req.files.pdf.mimetype == "application/pdf"
    ) {
        await rpg.execSQL({
            dbcon: pass.dbcon,
            sql:   `
            INSERT INTO designs_documents(PATH, dsgnid, uploader)
            VALUES ($1,$2,$3)
            `,
            sqlParams: [
                rpg.param("calc", "path"), 
                rpg.param("post", "dsgnid"), 
                rpg.param("ses", "uid")
            ],
            onStart: (ses, data, calc) => {
                calc.path = "assets/uploads" + req.files.pdf.file.split("uploads")[1];
            },
            onEnd: () => {
            }
        })(req, res);
        res.end('{"status":"ok"}');
    }
    res.end('{"status":"err"}');
});


router.post("/delete-design-document", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE designs_documents
    SET active = FALSE
    WHERE id = $1
    `,
    postReqData: ["dsgnid"],
    sqlParams:   [rpg.param("post", "dsgnid")]
}));

router.post("/upload-design", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: `
        INSERT INTO DESIGNS (creator, design)
        VALUES ($1, $2)
        RETURNING id
    `,
    sqlParams: [
        rpg.param("ses", "uid"),
        rpg.param("post", "design")
    ],
    onEnd: (req, res, result) => {
        //console.log(`[upload-design] new design: ${JSON.stringify(req.session)}`);
        //console.log(`[upload-design] new design: ${JSON.stringify(req.body.design)}`);
        if (result && result.id) {
            const newDesignId = result.id;
            //console.log(`[upload-design] new design id: ${newDesignId}`);
            res.json({ status: "ok", id: newDesignId });
        } else {
            res.status(500).json({ status: "err", message: "Failed to retrieve design ID" });
        }
    },
    onError: (err, req, res) => {
        console.error("Error in /upload-design query:", err);
        res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
}));

router.post("/get-design", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
        SELECT design
        FROM DESIGNS
        WHERE id = $1
    `,
    sqlParams: [rpg.param("body", "id")],
    onStart:   (req, res) => { 
        //console.log(`[get-design] onStart - Received request body: ${JSON.stringify(req)}`);
        // const id = req.body?.id || "undefined";
        // console.log(`[get-design] Fetching design with id: ${id}`);
    },
    onEnd: (req, res, result) => {
        // console.log(`[get-design] onEnd - Design is: ${JSON.stringify(result.design)}`);
        if (result && result.design) {
            // console.log(`Found design for id: ${req.body?.id}`);
            const design = JSON.stringify(result.design);
            res.json({ status: "ok", result: design });
        } else {
            // console.log("Design not found for id:", req.body?.id);
            res.status(404).json({ status: "err", message: "Design not found" });
        }
    },
    onError: (err, req, res) => {
        // console.error("Error in /get-design query:", err);
        res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
}));

router.get("/get-user-designs", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
        SELECT id, design, public, locked
        FROM DESIGNS
        WHERE creator = $1
        ORDER BY id DESC;
    `,
    sesReqData: ["uid"],
    sqlParams:  [rpg.param("ses", "uid")],
    onEnd:      (req, res, result) => {
        // Ensure result is an array
        const rows = Array.isArray(result) ? result : [result];

        const designs = rows.map(row => ({
            ...row.design,
            id:     row.id,
            public: row.public,
            locked: row.locked
        }));

        // console.log(`[get-user-designs] ${JSON.stringify(designs)}`);

        res.json({ status: "ok", result: designs });
    },
    onError: (err, req, res) => {
        console.error("Error in /get-user-designs query:", err);
        res.status(400).json({ status: "err", error: "Error retrieving user designs." });
    }
}));

router.get("/get-public-designs", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
        SELECT id, design
        FROM DESIGNS
        WHERE public = true
            AND creator != $1
        ORDER BY id DESC;
    `,
    sesReqData: ["uid"],
    sqlParams:  [rpg.param("ses", "uid")],
    onEnd:      (req, res, result) => {
        // Ensure result is an array
        const rows = Array.isArray(result) ? result : [result];

        const designs = rows.map(row => ({
            ...row.design,
            id: row.id
        }));

        res.json({ status: "ok", result: designs });
    },
    onError: (err, req, res) => {
        console.error("Error in /get-public-designs query:", err);
        res.status(400).json({ status: "err", error: "Error retrieving public designs." });
    }
}));


router.post("/design-public", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE DESIGNS
    SET PUBLIC = NOT PUBLIC
    WHERE id = $1;
    `,
    sqlParams:   [rpg.param("post", "dsgnid")]
}));

router.post("/design-lock", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE DESIGNS
    SET locked = NOT locked
    WHERE id = $1;
    `,
    sqlParams:   [rpg.param("post", "dsgnid")]
}));

router.post("/update-design", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
        UPDATE DESIGNS
        SET design = $1
        WHERE creator = $2
            AND id = $3
    `,
    sesReqData:  ["uid"],
    postReqData: ["id", "design"],
    sqlParams:   [
        rpg.param("post", "design"),
        rpg.param("ses", "uid"),
        rpg.param("post", "id")
    ],
    onEnd: (req, res) => {
        res.json({ status: "ok" });
    },
    onError: (err, req, res) => {
        console.error("Error in /update-design query:", err);
        res.status(400).json({ status: "err", error: "Error updating design." });
    }
}));

router.post("/delete-design", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
        DELETE FROM DESIGNS
        WHERE creator = $1
            AND id = $2
    `,
    sesReqData:  ["uid"],
    postReqData: ["id"],
    sqlParams:   [
        rpg.param("ses", "uid"),
        rpg.param("post", "id")
    ],
    onEnd: (req, res) => {
        res.json({ status: "ok" });
    },
    onError: (err, req, res) => {
        console.error("Error in /delete-design query:", err);
        res.status(400).json({ status: "err", error: "Error deleting design." });
    }
}));

router.post("/designs-documents", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        PATH
    FROM designs_documents
    WHERE dsgnid = $1
        AND active = TRUE
    `,
    sqlParams:   [rpg.param("post", "dsgnid")]
}));


//############################################
router.post("/documents-session", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        title,
        PATH
    FROM documents
    WHERE sesid = $1
        AND active = TRUE
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));

router.post("/questions-session", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        content,
        OPTIONS,
        answer,
        COMMENT,
        other,
        textid,
        plugin_data
    FROM questions
    WHERE sesid = $1
    ORDER BY id ASC
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-new-users", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        name,
        mail
    FROM users
    WHERE id NOT IN (
        SELECT u.id
        FROM users AS u,
            sesusers AS su
        WHERE u.id = su.uid
            AND su.sesid = $1
    )
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));

router.post("/get-ses-users", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT u.id,
        u.name,
        u.mail,
        u.aprendizaje,
        u.role,
        su.device
    FROM users AS u,
        sesusers AS su
    WHERE u.id = su.uid
        AND su.sesid = $1
    ORDER BY u.role DESC
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));

router.post("/add-ses-users", async (req, res) => {
    let sql = `
    INSERT INTO sesusers(UID, sesid)
    VALUES
    `;
    req.body.users.forEach((uid) => {
        if (!isNaN(uid))
            sql += `(${uid},${req.body.sesid}), `;
    });
    sql = sql.substring(0, sql.length - 2); // removing trailing comma
    await rpg.execSQL({
        dbcon: pass.dbcon,
        sql:   sql
    })(req, res);
});

router.post("/get-all-users", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT u.id,
        u.name,
        u.mail,
        u.rut,
        u.role
    FROM users AS u
    `,
    sqlParams: [],
    onStart:   (ses) => {
        if (ses.role != "S") return "SELECT 1";
    },
}));

router.post("/convert-prof", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE users
    SET ROLE = 'P'
    WHERE id = $1
    `,
    postReqData: ["uid"],
    sqlParams:   [rpg.param("post", "uid")],
    onStart:     (ses) => {
        if (ses.role != "S") return "SELECT $1";
    },
}));

router.post("/remove-prof", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE users
    SET ROLE = 'R'
    WHERE id = $1
    `,
    postReqData: ["uid"],
    sqlParams:   [rpg.param("post", "uid")],
    onStart:     (ses) => {
        if (ses.role != "S") return "SELECT $1";
    },
}));

router.post("/get-question-text", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        title,
        content
    FROM question_text
    WHERE sesid = $1
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));

router.post("/delete-ses-user", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    DELETE
    FROM sesusers
    WHERE sesid = $1
        AND UID = $2
    `,
    postReqData: ["sesid", "uid"],
    sqlParams:   [rpg.param("post", "sesid"), rpg.param("post", "uid")]
}));


router.post("/get-selection-comment", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT answer,
        COMMENT,
        confidence
    FROM selection
    WHERE UID = $1
        AND qid = $2
        AND iteration = $3
    `,
    postReqData: ["qid", "uid", "iteration"],
    sqlParams:   [
        rpg.param("post", "uid"), rpg.param("post", "qid"), rpg.param("post", "iteration")
    ]
}));


router.post("/get-selection-team-comment", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.answer,
        s.comment,
        s.confidence,
        u.name AS uname
    FROM selection AS s
    INNER JOIN teamusers AS tu
    ON tu.uid = s.uid
    INNER JOIN users AS u
    ON u.id = s.uid
    WHERE tu.tmid = $1
        AND s.qid = $2
        AND iteration = 3
    `,
    postReqData: ["qid", "tmid"],
    sqlParams:   [rpg.param("post", "tmid"), rpg.param("post", "qid")]
}));

router.post("/semantic-documents", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        title,
        content
    FROM semantic_document
    WHERE sesid = $1
    ORDER BY orden ASC
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));

router.post("/get-semantic-documents", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        title,
        content
    FROM semantic_document
    WHERE sesid = $1
    ORDER BY orden ASC
    `,
    sesReqData: ["ses"],
    sqlParams:  [rpg.param("ses", "ses")]
}));


router.post("/add-semantic-unit", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO semantic_unit(sentences, docs, COMMENT, UID, sesid, iteration)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING id
    `,
    postReqData: ["comment", "sentences", "docs", "iteration"],
    sesReqData:  ["uid", "ses"],
    sqlParams:   [
        rpg.param("post", "sentences"), rpg.param("post", "docs"), rpg.param("post", "comment"),
        rpg.param("ses", "uid"), rpg.param("ses", "ses"), rpg.param("post", "iteration")
    ]
}));

router.post("/add-sync-semantic-unit", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO semantic_unit(sentences, docs, COMMENT, UID, sesid, iteration)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING id
    `,
    postReqData: ["comment", "sentences", "docs", "iteration", "uidoriginal"],
    sesReqData:  ["uid", "ses"],
    sqlParams:   [
        rpg.param("post", "sentences"), rpg.param("post", "docs"), rpg.param("post", "comment"),
        rpg.param("post", "uidoriginal"), rpg.param("ses", "ses"), rpg.param("post", "iteration")
    ]
}));


router.post("/update-semantic-unit", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE semantic_unit
    SET
        (sentences, COMMENT, docs) = ($1, $2, $3)
    WHERE id = $4
    `,
    postReqData: ["comment", "sentences", "docs", "id"],
    sesReqData:  ["uid"],
    sqlParams:   [
        rpg.param("post", "sentences"), rpg.param("post", "comment"),
        rpg.param("post", "docs"), rpg.param("post", "id")
    ]
}));


router.post("/get-semantic-units", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT u.id,
        u.sentences,
        u.comment,
        u.docs,
        u.iteration
    FROM semantic_unit AS u
    WHERE u.uid = $1
        AND u.sesid = $2
        AND (
            u.iteration = $3
            OR u.iteration <= 0
        )
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["iteration"],
    sqlParams:   [
        rpg.param("ses", "uid"), rpg.param("ses", "ses"), rpg.param("post", "iteration")
    ]
}));


router.post("/get-team-sync-units", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT u.id,
        u.sentences,
        u.comment,
        u.docs,
        u.iteration
    FROM semantic_unit AS u
    WHERE u.uid in (
        SELECT original_leader
        FROM teams
        INNER JOIN teamusers
        ON tmid = id
        WHERE UID = $1
        AND sesid = $2
    )
        AND u.sesid = $3
        AND u.iteration = 3
    ORDER BY u.id ASC
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("ses", "uid"), rpg.param("ses", "ses"), rpg.param("ses", "ses")]
}));


router.post("/delete-semantic-unit", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    DELETE
    FROM semantic_unit
    WHERE id = $1
    `,
    postReqData: ["id"],
    sqlParams:   [rpg.param("post", "id")]
}));


router.post("/update-ses-options", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE sessions
    SET OPTIONS = $1
    WHERE id = $2
    `,
    postReqData: ["sesid", "options"],
    sqlParams:   [rpg.param("post", "options"), rpg.param("post", "sesid")]
}));


router.post("/differentials", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT *
    FROM differential
    WHERE sesid = $1
    ORDER BY orden
    `,
    postReqData: ["sesid"],
    sesReqData:  ["uid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-differentials", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT *
    FROM differential
    WHERE sesid = $1
    ORDER BY orden
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("ses", "ses")]
}));

router.post("/add-differential", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO differential(title, tleft, tright, orden, creator, sesid)
    SELECT $1,
        $2,
        $3,
        $4,
        $5,
        $6
    WHERE NOT EXISTS (
        SELECT id
        FROM differential
        WHERE orden = $7
            AND sesid = $8
    )
    `,
    postReqData: ["orden", "tleft", "tright", "name", "sesid"],
    sesReqData:  ["uid"],
    sqlParams:   [
        rpg.param("post", "name"), rpg.param("post", "tleft"), rpg.param("post", "tright"),
        rpg.param("post", "orden"), rpg.param("ses", "uid"), rpg.param("post", "sesid"),
        rpg.param("post", "orden"), rpg.param("post", "sesid")
    ]
}));

router.post("/add-differential-stage", async (req, res) => { 
    console.log(`/add-differential-stage: ${JSON.stringify(req.body)}`)
    await rpg.execSQL({
        dbcon: pass.dbcon,
        sql:   `
        INSERT INTO differential(
            title, tleft, tright, orden, creator, stageid, num, justify, sesid, word_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        postReqData: ["orden", "tleft", "tright", "name", "stageid", "num", "justify", "sesid"],
        sesReqData:  ["uid"],
        sqlParams:   [
            rpg.param("post", "name"), rpg.param("post", "tleft"), rpg.param("post", "tright"),
            rpg.param("post", "orden"), rpg.param("ses", "uid"), rpg.param("post", "stageid"),
            rpg.param("post", "num"), rpg.param("post", "justify"), rpg.param("post", "sesid"),
            rpg.param("post", "word_count")
        ]
    })(req, res);
});

router.post("/update-differential", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE differential
    SET title = $1,
        tleft = $2,
        tright = $3
    WHERE id = $4
    `,
    postReqData: ["tleft", "tright", "name", "id"],
    sesReqData:  ["uid"],
    sqlParams:   [
        rpg.param("post", "name"), rpg.param("post", "tleft"), rpg.param("post", "tright"),
        rpg.param("post", "id")
    ]
}));


router.post("/duplicate-session", async (req, res) => {
    if (
        req.session.uid != null && req.session.role == "P" && req.body.name != null
        && req.body.name != "" && req.body.tipo != null && req.body.descr != null
        && req.body.originalSesid != null
    ) {
        await rpg.singleSQL({
            dbcon: pass.dbcon,
            sql:   `
            INSERT INTO sessions(name, descr, creator, TIME, status, TYPE)
            VALUES ($1, $2, $3, now(), 1, $4)
            RETURNING id
            `,
            postReqData: ["sesid", "uid"],
            sqlParams:   [
                rpg.param("post", "name"), rpg.param("post", "descr"), rpg.param("ses", "uid"),
                rpg.param("post", "tipo")
            ],
            onEnd: async (req, res, result) => {
                let sesid = result.id;
                let oldsesid = req.body.originalSesid;
                if (req.body.copyUsers) {
                    await rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO sesusers(sesid, UID)
                        SELECT ${sesid} AS sesid, UID
                        FROM sesusers
                        WHERE sesid = ${oldsesid}
                        `,
                        preventResEnd: true,
                        onEnd:         () => {}
                    })(req,res);
                }
                else {
                    await rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO sesusers(sesid, UID)
                        VALUES (${sesid}, ${req.session.uid})
                        `,
                        preventResEnd: true,
                        onEnd:         () => {}
                    })(req,res);
                }
                if (req.body.copyDocuments) {
                    await rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO documents(sesid, title, PATH, uploader, active)
                        SELECT ${sesid} AS sesid,
                            title,
                            PATH,
                            uploader,
                            active
                        FROM documents
                        WHERE sesid = ${oldsesid}
                        `,
                        preventResEnd: true,
                        onEnd:         () => {}
                    })(req,res);
                }
                if (req.body.copyDifferentials) {
                    await rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO differential(sesid, title, tleft, tright, orden, creator)
                        SELECT ${sesid} AS sesid,
                            title,
                            tleft,
                            tright,
                            orden,
                            creator
                        FROM differential
                        WHERE sesid = ${oldsesid}
                        `,
                        preventResEnd: true,
                        onEnd:         () => {}
                    })(req,res);
                }
                if (req.body.copyQuestions) {
                    await rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO questions(
                            sesid, content, OPTIONS, answer, COMMENT, other, textid, plugin_data,
                            cpid
                        )
                        SELECT ${sesid} AS sesid,
                            content,
                            OPTIONS,
                            answer,
                            COMMENT,
                            other,
                            textid,
                            plugin_data,
                            id AS cpid
                        FROM questions
                        WHERE sesid = ${oldsesid}
                        ORDER BY id ASC
                        `,
                        preventResEnd: true
                    })(req,res);
                    await rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO question_text(sesid, content, title)
                        SELECT ${sesid} AS sesid,
                            content,
                            title
                        FROM question_text
                        WHERE sesid = ${oldsesid}
                        `,
                        preventResEnd: true,
                        onEnd:         () => {}
                    })(req,res);
                }
            }
        })(req,res);
    }
    else {
        res.end('{"status":"err"}');
    }
});

router.post("/generate-session-code", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE sessions
    SET code = $1
    WHERE id = $2
        AND code IS NULL RETURNING code
    `,
    postReqData: ["id"],
    sesReqData:  ["uid"],
    sqlParams:   [rpg.param("calc", "code"), rpg.param("post", "id")],
    onStart:     (ses, data, calc) => {
        calc.code = generateCode(data.id);
    }
}));

router.post("/archive-session", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE sessions
    SET archived = $1
    WHERE id = $2
    `,
    postReqData: ["sesid", "val"],
    sqlParams:   [rpg.param("post", "val"), rpg.param("post", "sesid")],
}));

router.post("/enter-session-code", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO sesusers(UID, sesid, device)
    SELECT $1::int AS UID,
        id,
        $2 AS device
    FROM sessions
    WHERE code = $3
    AND NOT EXISTS (
        SELECT su.sesid
        FROM sesusers AS su,
            sessions AS s
        WHERE su.uid = $4
            AND s.code = $5
            AND su.sesid = s.id
    )
    AND NOT EXISTS (
        SELECT st.id
        FROM stages AS st,
            sessions AS ss
        WHERE st.sesid = ss.id
            AND ss.code = $6
            AND st.type = 'team'
    ) RETURNING sesid
    `,
    postReqData: ["code"],
    sesReqData:  ["uid"],
    sqlParams:   [
        rpg.param("ses", "uid"), rpg.param("post", "device"), rpg.param("post", "code"),
        rpg.param("ses", "uid"), rpg.param("post", "code"), rpg.param("post", "code")
    ],
    preventResEnd: true,
    onEnd:         async (req, res, result) => {
        if(result.sesid == null){
            res.end('{"status": "end"}');
        }
        else{
            let id = result.sesid;
            await rpg.singleSQL({
                dbcon: pass.dbcon,
                sql:   `
                SELECT TYPE
                FROM sessions
                WHERE id = ${id}
                `,
                onEnd: (req,res,result) => {
                    let type = result.type;
                    if(type == null){
                        res.end('{"status": "end"}');
                    }
                    else{
                        req.session.ses = id;
                        let urlr = (type == "R" || type == "J") ?
                            "role-playing" :
                            (type == "T") ? "ethics" : "select";
                        res.end(JSON.stringify({status: "ok", redirect: urlr}));
                    }
                }
            })(req,res);
        }
    }
}));

router.post("/stage-state-df", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT COUNT(*), query1.stage_id1 as id FROM (SELECT 
        stages.id AS stage_id1, 
        differential_selection.uid as uid,
        COUNT(differential_selection.uid) AS num_answers
      FROM 
        stages 
        JOIN differential ON stages.id = differential.stageid 
        JOIN differential_selection ON differential.id = differential_selection.did 
      WHERE 
        stages.sesid = $1
      GROUP BY 
        stages.id, differential_selection.uid
      ) as query1 JOIN (
      SELECT 
        stages.id AS stage_id2, 
        COUNT(differential.id) AS questions
      FROM 
        stages 
        JOIN differential ON stages.id = differential.stageid 
      WHERE 
        stages.sesid = $1
      GROUP BY 
        stages.id
        ) as query2 ON query1.stage_id1= query2.stage_id2
      
        WHERE query1.num_answers = query2.questions GROUP BY query1.stage_id1;
    `,
    postReqData: ["sesid"], //differential_selection uid
    onStart:     (ses) => {  //Session -> Stage -> Differential -> Differential_Selection {id:stage, counter: respuestas completas}
        if (ses.role != "P") { //sesusers role != P
            console.error("Sólo el profesor puede ver el estado de los alumnos");
            return "SELECT $1";
        }
    },
    sqlParams: [rpg.param("post", "sesid")]
}));

router.post("/stage-state-r", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT COUNT(act.id), s.id FROM actor_selection act 
    INNER JOIN stages s ON act.stageid = s.id AND s.sesid = $1 GROUP BY s.id;
    `,
    postReqData: ["sesid"],
    onStart:     (ses) => {
        if (ses.role != "P") {
            console.error("Sólo el profesor puede ver el estado de los alumnos");
            return "SELECT $1";
        }
    },
    sqlParams: [rpg.param("post", "sesid")]
}));


function generateCode(id) {
    let n = id*5 + 255 + ~~(Math.random()*5);
    let s = n.toString(16);
    return "k00000".substring(0, 6 - s.length) + s;
}

export default router;
