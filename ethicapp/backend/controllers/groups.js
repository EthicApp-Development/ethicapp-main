"use strict";

import express from "express";
import config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";

const router = express.Router();

/**
 * @route GET /phases/:id/groups
 * @description Retrieves all groups (teams) for a given phase (stage), along with their participants.
 *              The response includes the group ID, a sequential number for the group, and a list of participant IDs.
 * @param {string} id - The ID of the phase (from the URL path).
 * @returns {Object} - A JSON object containing the list of groups and their participants.
 * 
 * @example
 * // Request
 * GET /phases/123/groups
 * 
 * // Response (success)
 * {
 *   "groups": [
 *     {
 *       "id": 1,
 *       "number": 1,
 *       "participants": [101, 102, 103]
 *     },
 *     {
 *       "id": 2,
 *       "number": 2,
 *       "participants": [104, 105]
 *     }
 *   ]
 * }
 * 
 * // Response (missing required parameter)
 * {
 *   "error": "Missing required parameter: id."
 * }
 * 
 * // Response (no groups found)
 * {
 *   "error": "No groups found for the given phase."
 * }
 * 
 * // Response (internal server error)
 * {
 *   "error": "Internal server error."
 * }
 */
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

/**
 * @route POST /phase/:id/groups
 * @description Updates the group structure for a phase, replacing any existing groups with the new structure provided.
 *              This involves deleting old group data and inserting the new group structure.
 * @param {string} id - The ID of the phase (stage) (from the URL path).
 * @param {Object} body - The body of the request containing:
 *   - `groups`: An array of arrays, where each inner array represents a group and its user IDs.
 * @returns {Object} - A JSON object indicating the success or failure of the operation.
 */
router.post("/phase/:id/groups", async (req, res) => {
    const { id } = req.params; // Phase (stage) ID
    const { groups } = req.body; // Groups data from the request body

    // Validate required parameters
    if (!id || !groups || !Array.isArray(groups)) {
        return res.status(400).json({ status: "err", error: "Missing or invalid parameters: id or groups." });
    }

    try {
        // Step 1: Delete existing team users linked to the phase
        await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                DELETE FROM teamusers AS tu
                USING teams AS t
                WHERE tu.tmid = t.id AND t.stageid = $1
            `,
            sqlParams: [id],
        });

        // Step 2: Delete existing teams linked to the phase
        await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                DELETE FROM teams
                WHERE stageid = $1
            `,
            sqlParams: [id],
        });

        // Step 3: Insert new teams and their members
        for (const team of groups) {
            if (!Array.isArray(team) || team.length === 0) {
                throw new Error("Invalid group format: each group must be a non-empty array of user IDs.");
            }

            // Insert a team and retrieve the generated team ID
            const result = await rpg2.execSQL({
                dbcon: config.dbconnString,
                sql: `
                    INSERT INTO teams(stageid, leader, original_leader)
                    VALUES ($1, $2, $2)
                    RETURNING id
                `,
                sqlParams: [id, team[0]], // First user in the group is the leader
            });

            const teamId = result[0].id;

            // Insert team members into `teamusers`
            await rpg2.execSQL({
                dbcon: config.dbconnString,
                sql: `
                    INSERT INTO teamusers(tmid, uid)
                    SELECT $1, unnest($2::int[])
                `,
                sqlParams: [teamId, `{${team.join(",")}}`], // Convert array to PostgreSQL array format
            });
        }

        // Successful response after all operations complete
        res.status(200).json({ status: "ok", message: "Groups updated successfully." });
    } catch (error) {
        console.error("Error in /phase/:id/groups:", error);
        res.status(500).json({ status: "err", error: "Internal server error" });
    }
});

