"use strict";

import express from "express";
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { requireRole } from "../helpers/auth-helper.js";

const router = express.Router();

function normalizeLocale(value) {
    return String(value || "").toLowerCase().startsWith("es") ? "es_CL" : "en_US";
}

function normalizeScope(value) {
    return String(value || "").trim().toLowerCase() === "design" ? "design" : "case";
}

router.get("/tags/search", async (req, res) => {
    if (!requireRole(req, res, ["P", "A"])) {
        return;
    }

    const query = String(req.query.q || "").trim();
    const scope = normalizeScope(req.query.scope);
    const locale = normalizeLocale(req.query.locale);

    if (query.length < 2) {
        return res.status(200).json({ status: "ok", result: [] });
    }

    const scopeSql = scope === "design"
        ? "t.usable_for_designs = true"
        : "t.usable_for_cases = true";

    try {
        const tags = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT t.id,
                       t.code,
                       COALESCE(tt.label, fallback_tt.label, t.code) AS label,
                       COALESCE(tt.description, fallback_tt.description) AS description,
                       c.code AS category_code,
                       COALESCE(ct.label, fallback_ct.label, c.code) AS category_label
                FROM tags t
                INNER JOIN tag_categories c
                    ON c.id = t.category_id
                LEFT JOIN tag_translations tt
                    ON tt.tag_id = t.id
                   AND tt.locale = $2
                LEFT JOIN tag_translations fallback_tt
                    ON fallback_tt.tag_id = t.id
                   AND fallback_tt.locale = 'en_US'
                LEFT JOIN tag_category_translations ct
                    ON ct.category_id = c.id
                   AND ct.locale = $2
                LEFT JOIN tag_category_translations fallback_ct
                    ON fallback_ct.category_id = c.id
                   AND fallback_ct.locale = 'en_US'
                WHERE t.is_active = true
                  AND c.is_active = true
                  AND ${scopeSql}
                  AND (
                    LOWER(t.code) LIKE LOWER($1)
                    OR LOWER(COALESCE(tt.label, fallback_tt.label, '')) LIKE LOWER($1)
                    OR LOWER(COALESCE(tt.description, fallback_tt.description, '')) LIKE LOWER($1)
                    OR EXISTS (
                        SELECT 1
                        FROM unnest(COALESCE(tt.search_keywords, fallback_tt.search_keywords, ARRAY[]::text[])) AS keyword
                        WHERE LOWER(keyword) LIKE LOWER($1)
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM tag_aliases ta
                        WHERE ta.tag_id = t.id
                          AND LOWER(ta.alias_code) LIKE LOWER($1)
                    )
                  )
                ORDER BY c.sort_order, t.sort_order, label
                LIMIT 12;
            `,
            sqlParams: [
                rpg2.param("plain", `%${query}%`),
                rpg2.param("plain", locale),
            ],
        });

        return res.status(200).json({
            status: "ok",
            result: tags.map((tag) => ({
                id: tag.id,
                code: tag.code,
                label: tag.label,
                description: tag.description,
                categoryCode: tag.category_code,
                categoryLabel: tag.category_label,
            })),
        });
    } catch (error) {
        console.error("Error searching tags:", error);
        return res.status(500).json({ status: "err", message: "Failed to search tags." });
    }
});

export default router;
