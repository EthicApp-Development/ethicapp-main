"use strict";

import express from "express";
import config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";
import * as GroupsHelper from "../helpers/groups-helper.js"

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
                       tu.uid AS user_id,
                       tu.anon_mask
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

router.get("/phases/:id/user_group/:user_id", async (req, res) => {
    const { id: stageId, user_id: userId } = req.params;

    // Validate that both required parameters are present
    if (!stageId || !userId) {
        return res.status(400).json({ error: "Missing required parameters: stage_id and/or user_id" });
    }

    try {
        // Query to find the group (team) of the specified user in the given phase
        const results = await rpg2.execSQL({
            sql: `
                SELECT t.id AS team_id,
                       tu.uid AS user_id,
                       tu.anon_character
                FROM teams AS t
                INNER JOIN teamusers AS tu
                    ON t.id = tu.tmid
                WHERE t.stageid = $1 AND tu.uid = $2
                ORDER BY tu.uid
            `,
            dbcon: config.dbconnString,
            sqlParams: [stageId, userId],
        });

        // If no group is found for the user, return a 404 error
        if (results.length === 0) {
            return res.status(404).json({ error: "User not found in any group for the given phase." });
        }

        // Extract the team ID from the results
        const teamId = results[0].team_id;

        // Query to get all participants in the same team
        const groupParticipants = await rpg2.execSQL({
            sql: `
                SELECT tu.uid AS user_id,
                       tu.anon_character
                FROM teamusers AS tu
                WHERE tu.tmid = $1
                ORDER BY tu.uid
            `,
            dbcon: config.dbconnString,
            sqlParams: [teamId],
        });

        // Respond with the team details and its participants
        res.status(200).json({
            team_id: teamId,
            participants: groupParticipants.map(row => ({
                user_id: row.user_id,
                anon_character: row.anon_character,
            })),
        });
    } catch (err) {
        // Log the error for debugging purposes
        console.error("Error fetching user group:", err);

        // Respond with a 500 error for any internal server issue
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * Endpoint to create groups for a specific phase in a session.
 * Route: POST /phase/:id/groups
 */
router.post("/phase/:id/groups", async (req, res) => {
    const { id: sessionId } = req.params; // Get the session ID from the route parameter

    try {
        // Retrieve all phases for the session
        const phases = await ActivitiesHelper.getPhasesForSession(sessionId);
        if (phases.length === 0) {
            return res.status(404).json({ error: "No phases found for the session." });
        }

        // Identify the active phase (the one requiring group creation)
        const activePhase = phases.find(phase => phase.active);
        if (!activePhase) {
            return res.status(400).json({ error: "No active phase found for this session." });
        }

        // Start off by deleting any groups previously created in the current phase
        await GroupsHelper.deleteGroupsForPhase(activePhase.id);

        // Retrieve the design associated with the active phase
        const design = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT design
                FROM designs
                WHERE id = (
                    SELECT dsgnid
                    FROM sessions
                    WHERE id = $1
                )
            `,
            sqlParams: [sessionId],
        });

        if (design.length === 0) {
            return res.status(404).json({ error: "Design not found for the session." });
        }

        // Extract phase-specific details from the design
        const phaseDesign = design[0].design.phases[activePhase.number - 1];
        const groupSize = phaseDesign.stdntAmount; // Expected group size
        const groupingAlgorithm = phaseDesign.grouping_algorithm; // Grouping strategy (e.g., "random", "preserve_groups")

        // Initialize groups based on the specified algorithm
        let groups;
        let algorithm = GroupsHelper.groupingAlgorithms[groupingAlgorithm];

        if (!algorithm) {
            return res.status(400).json({ error: `Unsupported grouping algorithm: ${groupingAlgorithm}` });
        }
        groups = await algorithm(sessionId, phases, groupSize)

        // Save the created groups into the database
        for (const group of groups) {

            // Insert a new team record for each group
            const team = await rpg2.singleSQL({
                dbcon: config.dbconnString,
                sql: `
                    INSERT INTO teams (sesid, stageid)
                    VALUES ($1, $2)
                    RETURNING id
                `,
                sqlParams: [sessionId, activePhase.id],
            });

            let maskCode = 'A'.charCodeAt(0);

            for (const userId of group) {
                if (maskCode > 'Z'.charCodeAt(0)) {
                    throw new Error("Exceeded allowed characters for anon_mask");
                }
            
                const mask = String.fromCharCode(maskCode);
                await rpg2.execSQL({
                    dbcon: config.dbconnString,
                    sql: `
                        INSERT INTO teamusers (tmid, uid, anon_mask)
                        VALUES ($1, $2, $3)
                    `,
                    sqlParams: [team.id, userId, mask],
                });
                maskCode++;
            }
        }

        // Respond with success
        res.status(201).json({ message: "Groups successfully created." });
    } catch (error) {
        // Log and handle any errors that occur during group creation
        console.error(error);
        res.status(500).json({ error: "Error occurred while creating groups." });
    }
});

export default router;




