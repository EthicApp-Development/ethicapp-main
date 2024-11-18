"use strict";

import express from "express";
import config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";

const router = express.Router();

router.get("/activities/:session_id/current_phase_number", async (req, res) => {
    const { session_id } = req.params;

    if (!session_id) {
        return res.status(400).json({ error: "Missing required parameter: session_id" });
    }

    try {
        const result = await rpg2.singleSQL({
            sql: `
                SELECT number
                FROM stages
                INNER JOIN sessions
                ON stages.id = sessions.current_stage
                WHERE sessions.id = $1
            `,
            dbcon: config.dbconnString,
            sqlParams: [session_id],
        });

        if (!result) {
            return res.status(404).json({ error: "No current phase found for the given session." });
        }

        res.status(200).json({ current_phase: result.number });
    } catch (err) {
        console.error("Error fetching current phase:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/activities/:session_id/responses", async (req, res) => {
    const { session_id } = req.params;

    if (!session_id) {
        return res.status(400).json({ error: "Missing required parameter: session_id" });
    }

    try {
        const results = await execSQL({
            sql: `
                SELECT d.stageid,
                       d.orden,
                       s.uid,
                       r.tmid,
                       s.did,
                       s.sel,
                       s.comment,
                       st.number AS phase_number
                FROM differential_selection AS s
                INNER JOIN differential AS d
                    ON s.did = d.id
                INNER JOIN stages AS st
                    ON d.stageid = st.id
                LEFT JOIN (
                    SELECT tu.*
                    FROM teamusers AS tu
                    INNER JOIN teams AS t
                        ON tu.tmid = t.id
                ) AS r
                    ON r.uid = s.uid
                WHERE st.sesid = $1
                ORDER BY d.stageid, s.uid, d.orden
            `,
            dbcon: config.dbconnString,
            sqlParams: [session_id],
        });

        if (results.length === 0) {
            return res.status(404).json({ error: "No responses found for the given activity." });
        }

        const groupedResponses = results.reduce((acc, row) => {
            const { stageid, phase_number, ...response } = row;
            if (!acc[stageid]) {
                acc[stageid] = {
                    stage_id: stageid,
                    phase_number,
                    responses: [],
                };
            }
            acc[stageid].responses.push(response);
            return acc;
        }, {});

        const responseArray = Object.values(groupedResponses);

        res.status(200).json({ phases: responseArray });
    } catch (err) {
        console.error("Error fetching activity responses:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/phases/:id/groups", async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: "Missing required parameter: id" });
    }

    try {
        const results = await rpg2.execSQL({
            sql: `
                SELECT t.id AS team_id,
                       tu.uid AS user_id
                FROM teams AS t
                LEFT JOIN teamusers AS tu
                    ON t.id = tu.tmid
                WHERE t.stageid = $1
                ORDER BY t.id, tu.uid
            `,
            dbcon: config.dbconnString,
            sqlParams: [id],
        });

        if (results.length === 0) {
            return res.status(404).json({ error: "No groups found for the given phase." });
        }

        const groupedTeams = results.reduce((acc, row) => {
            const { team_id, user_id } = row;

            if (!acc[team_id]) {
                acc[team_id] = {
                    id: team_id,
                    number: Object.keys(acc).length + 1,
                    participants: [],
                };
            }

            if (user_id) {
                acc[team_id].participants.push(user_id);
            }

            return acc;
        }, {});

        const responseArray = Object.values(groupedTeams);

        res.status(200).json({ groups: responseArray });
    } catch (err) {
        console.error("Error fetching groups:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/phases/:id/responses", async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: "Missing required parameter: id" });
    }

    try {
        const results = await rpg2.execSQL({
            sql: `
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
            dbcon: config.dbconnString,
            sqlParams: [id, id],
        });

        if (results.length === 0) {
            return res.status(404).json({ error: "No responses found for the given phase." });
        }

        res.status(200).json({ responses: results });
    } catch (err) {
        console.error("Error fetching responses:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/phases/:id/message_count", async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: "Missing required parameter: id" });
    }

    try {
        const results = await rpg2.execSQL({
            sql: `
                SELECT c.did,
                       u.uid,
                       u.tmid,
                       COUNT(*) AS message_count
                FROM differential_chat AS c
                INNER JOIN teamusers AS u
                    ON u.uid = c.uid
                INNER JOIN differential AS d
                    ON d.id = c.did
                INNER JOIN teams AS tm
                    ON tm.id = u.tmid
                WHERE d.stageid = $1
                  AND tm.stageid = $1
                GROUP BY c.did, u.uid, u.tmid
            `,
            dbcon: config.dbconnString,
            sqlParams: [id],
        });

        if (results.length === 0) {
            return res.status(404).json({ error: "No messages found for the given phase." });
        }

        const formattedResults = results.map(row => ({
            question_id: row.did,
            user_id: row.uid,
            team_id: row.tmid,
            message_count: parseInt(row.message_count, 10),
        }));

        res.status(200).json({ messages: formattedResults });
    } catch (err) {
        console.error("Error fetching messages:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/phases/:id/group_messages/:user_id", async (req, res) => {
    const { id, user_id } = req.params;

    if (!id || !user_id) {
        return res.status(400).json({ error: "Missing required parameters: id or user_id." });
    }

    try {
        const results = await rpg2.execSQL({
            sql: `
                SELECT s.id,
                       s.uid,
                       s.content,
                       s.stime,
                       s.parent_id,
                       s.stageid
                FROM chat AS s
                WHERE s.stageid = $1
                  AND s.uid IN (
                      SELECT tu.uid
                      FROM teamusers AS tu
                      WHERE tu.tmid = (
                          SELECT t.id
                          FROM teamusers AS tu,
                               teams AS t
                          WHERE t.stageid = $1
                            AND tu.tmid = t.id
                            AND tu.uid = $2
                      )
                  )
                ORDER BY s.stime ASC
            `,
            dbcon: config.dbconnString,
            sqlParams: [id, user_id], // `id` es el `stageid`, `user_id` es el identificador del usuario
        });

        if (results.length === 0) {
            return res.status(404).json({ error: "No messages found for the user's group in the given phase." });
        }

        res.status(200).json({ group_messages: results });
    } catch (err) {
        console.error("Error fetching group messages:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;