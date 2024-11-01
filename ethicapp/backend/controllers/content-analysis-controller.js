"use strict";

import express from "express";
import pass from "../helpers/compat-helper.js"
import configSocket from "../config/socket.config.js";
import * as rpg from "../db/rest-pg.js";
import { isContentAnalysisAvailable } from "../services/content-analysis/content-analysis.js";

let router = express.Router();

router.post('/content-analysis-callback', await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: `
        INSERT INTO content_analysis(response_selections, context, sesid, stage_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE
        SET response_selections = EXCLUDED.response_selections,
            context = EXCLUDED.context,
            stage_id = EXCLUDED.stage_id;
    `,
    postReqData: ["response_selections", "context"],
    sqlParams: [
        rpg.param("post", "response_selections", JSON.stringify),
        rpg.param("post", "context", JSON.stringify),
        rpg.param("post", "sesid"),
        rpg.param("post", "stage_id")
    ],
    onStart: (ses, data, calc) => {
        // Prepare necessary data in `req.body`
        if (!isContentAnalysisAvailable()) {
            throw new Error("Content analysis is not available");
        }
        
        // Add stage and session IDs to the request body for sqlParams
        data.stage_id = data.context.phase_id;
        data.sesid = data.context.session_id;
    },
    onEnd: (req, res) => {
        configSocket.contentUpdate(req.body);
        res.status(200).json({ status: 'success' });
    },
    onError: (err, req, res) => {
        if (err.message === "Content analysis is not available") {
            res.status(503).json({ error: "Content analysis is not available" });
        } else {
            console.error("Error in /content-analysis-callback:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
}));

router.post("/get-content-analysis", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: `
        SELECT *
        FROM content_analysis
        WHERE stage_id = $1
    `,
    postReqData: ["stageid"],
    sqlParams: [rpg.param("post", "stageid")],
    onStart: (ses, data, calc) => {
        if (!isContentAnalysisAvailable()) {
            throw new Error("Content analysis is not available");
        }
    },
    onEnd: (req, res, result) => {
        res.status(200).json({ status: "success", data: result });
    },
    onError: (err, req, res) => {
        if (err.message === "Content analysis is not available") {
            res.status(503).json({ error: "Content analysis is not available" });
        } else {
            console.error("Error in /get-content-analysis query:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
}));

router.post("/content-analysis-availability", (req, res, next) => {
    if(isContentAnalysisAvailable()){
        return res.status(200).json({ status: 'Content analysis is available'});
    }
    else{
        return res.status(503).json({ error: "Content analysis is not available" });
    }
});

export default router;