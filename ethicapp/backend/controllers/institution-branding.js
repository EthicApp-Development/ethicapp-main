"use strict";

import express from "express";
import * as config from "../config/database.config.js";
import { execSQL } from "../db/rest-pg-2.js";

const router = express.Router();

router.get("/institution/logo", async (req, res) => {
    try {
        const result = await execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT logo_mime_type, logo_bytes, logo_updated_at
                FROM institution
                WHERE id = 1
                  AND logo_bytes IS NOT NULL
                LIMIT 1
            `,
        });

        if (result.length === 0) {
            return res.status(404).json({ status: "err", message: "Logo not found." });
        }

        const logo = result[0];
        res.set("Content-Type", logo.logo_mime_type || "application/octet-stream");
        res.set("Cache-Control", "private, max-age=300");

        if (logo.logo_updated_at) {
            res.set("Last-Modified", new Date(logo.logo_updated_at).toUTCString());
        }

        return res.send(Buffer.from(logo.logo_bytes));
    } catch (error) {
        console.error("Error serving institution logo:", error);
        return res.status(500).json({ status: "err", message: "Failed to load logo." });
    }
});

export default router;
