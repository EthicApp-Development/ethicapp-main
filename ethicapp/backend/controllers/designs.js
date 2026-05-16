"use strict";

import express from "express";
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { hasTheUserRoleById } from '../helpers/users-helper.js';
import { requireRole } from "../helpers/auth-helper.js";

const router = express.Router();

router.get("/designs/:id", async (req, res) => {
    try {
        // Extract the design ID from request parameters
        const designId = req.params.id;

        // Validate input
        if (!designId) {
            return res.status(400).json({ status: "err", message: "Design ID is required" });
        }

        // Execute the SQL query to fetch the design
        const result = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT design
                FROM designs
                WHERE id = $1
            `,
            sqlParams: [designId], // Pass the ID directly as a parameter
        });

        // Check if the design was found
        if (result && result.design) {
            return res.json({ status: "ok", result: JSON.stringify(result.design) });
        } else {
            return res.status(404).json({ status: "err", message: "Design not found" });
        }
    } catch (err) {
        console.error("Error fetching design:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.post("/designs", async (req, res) => {
    try {
        const sessionUid = req.session?.uid;
        const { design, caseId = null } = req.body; // Extract the design object from the request body

        // Validate session
        if (!sessionUid) {
            return res.status(403).json({ status: "err", message: "Forbidden: You must be logged in to create a design." });
        }

        // Validate input
        if (!design) {
            return res.status(400).json({ status: "err", message: "Invalid input: Design data is required." });
        }

        let { id, ...designNoId } = design;

        // Insert the new design into the database
        const result = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                INSERT INTO designs (creator, design, case_id)
                VALUES ($1, $2, $3)
                RETURNING id
            `,
            sqlParams: [
                rpg2.param("plain", sessionUid), // Pass the session user ID as creator
                rpg2.param("plain", JSON.stringify(designNoId)), // Serialize the design object
                rpg2.param("plain", caseId),
            ],
        });

        // Check if the design was successfully created
        if (result && result.id) {
            return res.json({ status: "ok", id: result.id });
        } else {
            return res.status(500).json({ status: "err", message: "Failed to create design." });
        }
    } catch (err) {
        console.error("Error in POST /designs:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.patch("/designs/:id", async (req, res) => {
    try {
        const sessionUid = req.session?.uid;
        const designId = parseInt(req.params.id, 10); // Convert designId to an integer
        const { design, caseId = null } = req.body; // Extract the updated design from the request body

        // Validate session
        if (!sessionUid) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        // Validate input
        if (!designId || !design) {
            return res.status(400).json({ status: "err", message: "Invalid input" });
        }

        // Fetch the design and check permissions
        const existingDesign = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id, creator
                FROM designs
                WHERE id = $1
            `,
            sqlParams: [rpg2.param("plain", designId)],
        });

        if (!existingDesign) {
            return res.status(404).json({ status: "err", message: "Design not found" });
        }

        const isAdmin = await hasTheUserRoleById(sessionUid, 'A');
        if (!isAdmin && sessionUid !== existingDesign.creator) {
            return res.status(403).json({ status: "err", message: "Forbidden: You do not have permission to update this design." });
        }

        let {id, ...designNoId} = design;
        designNoId = JSON.stringify(designNoId);

        // Update the design
        await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE designs
                SET design = $1,
                    case_id = $2
                WHERE id = $3
            `,
            sqlParams: [
                rpg2.param("plain", designNoId),
                rpg2.param("plain", caseId),
                rpg2.param("plain", designId),
            ],
        });

        return res.json({ status: "ok", message: "Design updated successfully" });
    } catch (err) {
        console.error("Error in /designs/:id PATCH:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.put("/designs/:id", async (req, res) => {
    try {
        const sessionUid = req.session?.uid; // Get the user ID from the session
        const designId = req.params.id; // Get the design ID from the path
        const updatedDesign = req.body.design; // Get the updated design from the request body

        // Validate session
        if (!sessionUid) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        // Validate input
        if (!designId || !updatedDesign) {
            return res.status(400).json({ status: "err", message: "Design ID and updated design data are required" });
        }

        let {id, ...designNoId} = JSON.parse(updatedDesign);
        designNoId = JSON.stringify(designNoId);

        // Execute SQL to update the design
        const result = await singleSQL({
            dbcon: pass.dbcon,
            sql: `
                UPDATE designs
                SET design = $1
                WHERE creator = $2 AND id = $3
            `,
            sqlParams: [designNoId, sessionUid, designId],
        });

        // Check if the update was successful
        if (result) {
            return res.json({ status: "ok" });
        } else {
            return res.status(404).json({ status: "err", message: "Design not found or not owned by the user" });
        }
    } catch (err) {
        console.error("Error in /designs/:id PUT endpoint:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.get("/users/:id/designs", async (req, res) => {
    try {
        const userId = req.params.id; // Extract user ID from the path
        const sessionUid = req.session?.uid; // Get session user ID

        // Validate session
        if (!sessionUid) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        // Check if the user is allowed to access this data
        const isAdmin = await hasTheUserRoleById(sessionUid, 'A');
        if (sessionUid !== userId && !isAdmin) {
            return res.status(403).json({ status: "err", message: "Forbidden" });
        }

        // Execute SQL to fetch the designs
        const designs = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT d.id, d.design, d.public, d.locked,
                       d.case_id,
                       c.title AS case_title,
                       c.author_firstname AS case_author_firstname,
                       c.author_lastname AS case_author_lastname,
                       c.author_email AS case_author_email
                FROM designs d
                LEFT JOIN ethical_cases c ON c.id = d.case_id
                WHERE creator = $1
                ORDER BY d.id DESC;
            `,
            sqlParams: [userId], // Pass the user ID as a parameter
        });

        // Transform the result into the desired format
        const result = designs.map(row => ({
            ...row.design,
            id: row.id,
            public: row.public,
            locked: row.locked,
            caseId: row.case_id,
            associatedCase: row.case_id ? {
                id: row.case_id,
                title: row.case_title,
                authorFirstname: row.case_author_firstname,
                authorLastname: row.case_author_lastname,
                authorEmail: row.case_author_email,
            } : null,
        }));

        // Return the formatted designs
        return res.json({ status: "ok", result });
    } catch (err) {
        console.error("Error in /users/:id/designs:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.get("/designs", async (req, res) => {
    try {
        // Validate session
        const sessionUid = req.session?.uid;
        if (!sessionUid) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        // Execute SQL query to fetch designs
        const rows = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT DISTINCT ON (d.id) d.id, d.design, d.public, d.locked,
                       d.case_id,
                       c.title AS case_title,
                       c.author_firstname AS case_author_firstname,
                       c.author_lastname AS case_author_lastname,
                       c.author_email AS case_author_email,
                       u.firstname AS creator_firstname,
                       u.lastname AS creator_lastname,
                       u.name AS creator_name,
                       u.mail AS creator_email,
                       CASE WHEN d.creator = $1 THEN TRUE ELSE FALSE END AS user_owned
                FROM designs d
                LEFT JOIN ethical_cases c ON c.id = d.case_id
                LEFT JOIN users u ON u.id = d.creator
                WHERE d.creator = $1 OR d.public = TRUE
                ORDER BY d.id DESC, user_owned DESC;
            `,
            sqlParams: [sessionUid], // Pass session user ID as the parameter
        });

        // Process the rows to map to the desired structure
        const designs = rows.map(row => {
            const creatorName = [row.creator_firstname, row.creator_lastname]
                .filter(Boolean)
                .join(" ") || row.creator_name;
            const design = {
                ...row.design,
                id: row.id,
                public: row.public,
                locked: row.locked,
                caseId: row.case_id,
                associatedCase: row.case_id ? {
                    id: row.case_id,
                    title: row.case_title,
                    authorFirstname: row.case_author_firstname,
                    authorLastname: row.case_author_lastname,
                    authorEmail: row.case_author_email,
                } : null,
                userOwned: row.user_owned,
            };

            if (!row.user_owned && creatorName) {
                design.metainfo = {
                    ...(design.metainfo || {}),
                    authorName: creatorName,
                    email: row.creator_email || design.metainfo?.email,
                };
            }

            return design;
        });

        // Respond with the processed designs
        return res.json({ status: "ok", result: designs });
    } catch (err) {
        console.error("Error in /designs query:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.patch("/designs/:id/toggle_public", async (req, res) => {
    try {
        const designId = req.params.id;

        // Validate input
        if (!designId) {
            return res.status(400).json({ status: "err", message: "Design ID is required" });
        }

        // Execute SQL to toggle the public field
        await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE designs
                SET public = NOT public
                WHERE id = $1;
            `,
            sqlParams: [designId],
        });

        return res.json({ status: "ok", message: "Design public status toggled successfully" });
    } catch (err) {
        console.error("Error in /designs/:id/toggle_public:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.patch("/designs/:id/lock", async (req, res) => {
    try {
        const designId = req.params.id;

        // Validate input
        if (!designId) {
            return res.status(400).json({ status: "err", message: "Design ID is required" });
        }

        // Execute SQL to toggle the locked field
        await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE designs
                SET locked = true
                WHERE id = $1;
            `,
            sqlParams: [designId],
        });

        return res.json({ status: "ok", message: "Design locked successfully" });
    } catch (err) {
        console.error("Error in /designs/:id/lock:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.post("/designs/:id/duplicate", async (req, res) => {
    try {
        const sessionUid = req.session?.uid;
        const designId = parseInt(req.params.id, 10); // Convert designId to an integer

        if (!sessionUid) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        if (!designId) {
            return res.status(400).json({ status: "err", message: "Design ID is required" });
        }

        console.log(`[/designs/:id/duplicate] designId: '${designId}'`);

        // Fetch the design to clone
        const design = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id, creator, design, public, case_id
                FROM designs
                WHERE id = $1
            `,
            sqlParams: [rpg2.param("plain", designId)], // Use rpg2.param for proper formatting
        });

        if (!design) {
            return res.status(404).json({ status: "err", message: "Design not found" });
        }

        if (sessionUid !== design.creator && !design.public) {
            return res.status(403).json({ status: "err", message: "Forbidden: You cannot clone a private design you do not own." });
        }

        const { id, ...designNoId } = design.design;

        // Duplicate designs are not made public by default
        designNoId.public = false;

        // Duplicate designs are not locked by default
        designNoId.locked = false;

        // Serialize the design object
        const clonedDesign = JSON.stringify(designNoId);

        // Insert the cloned design into the database
        const result = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                INSERT INTO designs (creator, design, case_id)
                VALUES ($1, $2, $3)
                RETURNING id
            `,
            sqlParams: [
                rpg2.param("plain", sessionUid),
                rpg2.param("plain", clonedDesign), // Use rpg2.param for the serialized design
                rpg2.param("plain", design.case_id),
            ],
        });

        if (result && result.id) {
            return res.json({ status: "ok", id: result.id });
        } else {
            return res.status(500).json({ status: "err", message: "Failed to duplicate design" });
        }
    } catch (err) {
        console.error("Error in /designs/:id/duplicate:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.delete("/designs/:id", async (req, res) => {
    try {
        const sessionUid = req.session?.uid;
        const designId = parseInt(req.params.id, 10); // Convert designId to an integer

        // Validate session
        if (!sessionUid) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        // Validate input
        if (!designId) {
            return res.status(400).json({ status: "err", message: "Design ID is required" });
        }

        // Fetch the design
        const design = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id, creator
                FROM designs
                WHERE id = $1
            `,
            sqlParams: [rpg2.param("plain", designId)],
        });

        if (!design) {
            return res.status(404).json({ status: "err", message: "Design not found" });
        }

        // Check if the user is an admin or the creator of the design
        const isAdmin = await hasTheUserRoleById(sessionUid, 'A');
        if (!isAdmin && sessionUid !== design.creator) {
            return res.status(403).json({ status: "err", message: "Forbidden: You do not have permission to delete this design." });
        }

        // Delete the design
        await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                DELETE FROM designs
                WHERE id = $1
            `,
            sqlParams: [rpg2.param("plain", designId)],
        });

        // Return success response
        return res.json({ status: "ok", message: "Design deleted successfully" });
    } catch (err) {
        console.error("Error in /designs/:id DELETE:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

// Endpoint to check the validity of a design
router.get('/designs/:id/valid', async (req, res) => {
    try {
        const designId = parseInt(req.params.id, 10);

        // Validate input
        if (isNaN(designId)) {
            return res.status(400).json({ status: 'err', message: 'Invalid design ID' });
        }

        // Query the database for the design's valid flag
        const result = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT design ->> 'valid' AS valid
                FROM designs
                WHERE id = $1
            `,
            sqlParams: [rpg2.param("plain", designId)],
        });

        // Check if the design exists
        if (!result) {
            return res.status(404).json({ status: 'err', message: 'Design not found' });
        }

        // Convert 'valid' to a boolean
        const isValid = result.valid === 'true';
        return res.status(200).json({ status: 'ok', valid: isValid });

    } catch (err) {
        console.error('Error in GET /designs/:id/valid:', err);
        return res.status(500).json({ status: 'err', message: 'Internal Server Error' });
    }
});

router.get("/designs/:id/case", async (req, res) => {
    if (!requireRole(req, res, ["P", "A"])) {
        return;
    }

    try {
        const designId = parseInt(req.params.id, 10);
        if (isNaN(designId)) {
            return res.status(400).json({ status: "err", message: "Invalid design ID" });
        }

        const result = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT d.id AS design_id,
                       c.id,
                       c.title,
                       c.author_firstname,
                       c.author_lastname,
                       c.author_email
                FROM designs d
                LEFT JOIN ethical_cases c ON c.id = d.case_id
                WHERE d.id = $1;
            `,
            sqlParams: [rpg2.param("plain", designId)],
        });

        if (!result || !result.design_id) {
            return res.status(404).json({ status: "err", message: "Design not found" });
        }

        if (!result.id) {
            return res.status(200).json({ status: "ok", result: null });
        }

        return res.status(200).json({
            status: "ok",
            result: {
                id: result.id,
                title: result.title,
                authorFirstname: result.author_firstname,
                authorLastname: result.author_lastname,
                authorEmail: result.author_email,
            },
        });
    } catch (err) {
        console.error("Error in GET /designs/:id/case:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

export default router;
