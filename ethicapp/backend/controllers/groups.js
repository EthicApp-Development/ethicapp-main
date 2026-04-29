"use strict";

import express from "express";
import * as config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";
import * as GroupsHelper from "../helpers/groups-helper.js"
import * as ActivitiesHelper from "../helpers/activities-helper.js";

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

    // Validate required parameter
    if (!id || isNaN(Number(id))) {
        return res.status(400).json({ error: "Invalid or missing required parameter: id." });
    }

    try {
        // Fetch group data from the database
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
            sqlParams: [rpg2.param('plain', id)],
        });

        // Handle no results
        if (results.length === 0) {
            console.warn(`No groups found for phase_id: ${id}`);
            return res.status(404).json({ error: "No groups found for the given phase." });
        }

        // Group the results by team_id
        const groupedTeams = results.reduce((acc, { team_id, user_id }) => {
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

        // Convert the grouped object to an array
        const responseArray = Object.values(groupedTeams);

        // Log successful response
        console.info(`Successfully retrieved ${responseArray.length} groups for phase_id: ${id}.`);

        res.status(200).json({ groups: responseArray });
    } catch (err) {
        // Log error with context
        console.error(`Error fetching groups for phase_id: ${id}`, err);
        res.status(500).json({ error: "Internal server error." });
    }
});

router.get("/phases/:id/user_group/:user_id", async (req, res) => {
    const { id: phaseId, user_id: userId } = req.params;

    // Validate that both required parameters are present
    if (!phaseId || !userId) {
        return res.status(400).json({ error: "Missing required parameters: phase_id and/or user_id" });
    }

    try {
        // Query to find the group (team) of the specified user in the given phase
        const results = await rpg2.execSQL({
            sql: `
                SELECT t.id AS team_id,
                       tu.uid AS user_id,
                       tu.anon_mask
                FROM teams AS t
                INNER JOIN teamusers AS tu
                    ON t.id = tu.tmid
                WHERE t.stageid = $1 AND tu.uid = $2
                ORDER BY tu.uid
            `,
            dbcon: config.dbconnString,
            sqlParams: [rpg2.param('plain', phaseId), rpg2.param('plain', userId)],
        });

        // If no group is found for the user, return an empty success response
        if (results.length === 0) {
            return res.status(200).json({
                error: "User not found in any group for the given phase.",
                team_id: null,
                participants: [],
            });
        }

        // Extract the team ID from the results
        const teamId = results[0].team_id;

        // Query to get all participants in the same team
        const groupParticipants = await rpg2.execSQL({
            sql: `
                SELECT tu.uid AS user_id,
                       tu.anon_mask
                FROM teamusers AS tu
                WHERE tu.tmid = $1
                ORDER BY tu.uid
            `,
            dbcon: config.dbconnString,
            sqlParams: [rpg2.param('plain', teamId)],
        });

        // Respond with the team details and its participants
        res.status(200).json({
            team_id: teamId,
            participants: groupParticipants.map(row => ({
                user_id: row.user_id,
                anon_mask: row.anon_mask,
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
 * Endpoint to create groups for a specific phase (stage).
 * Route: POST /phases/:id/groups
 */
router.post("/phases/:id/groups", async (req, res) => {
    const { id: phaseId } = req.params; // Get the stage ID from the route parameter

    try {
        // Retrieve the session ID associated with the stage
        const sessionResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT sesid
                FROM stages
                WHERE id = $1
            `,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        if (sessionResult.length === 0) {
            return res.status(404).json({ error: "Phase not found." });
        }

        const sessionId = sessionResult[0].sesid;

        // Retrieve the design associated with the session
        const designResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT d.design
                FROM designs d
                INNER JOIN activity a ON d.id = a.design
                WHERE a.session = $1
            `,
            sqlParams: [rpg2.param('plain', sessionId)],
        });

        if (designResult.length === 0) {
            return res.status(404).json({ error: "Design not found for the session." });
        }

        const design = designResult[0].design;

        // Get the phases for the session
        const phases = await ActivitiesHelper.getPhasesForSession(sessionId);

        // Match the phase ID to its corresponding phase in the design
        const phase = phases.find(p => p.id === Number(phaseId));
        if (!phase) {
            return res.status(404).json({ error: "Phase not found in the session." });
        }

        const phaseDesign = design.phases[phase.number - 1];
        if (!phaseDesign) {
            return res.status(404).json({ error: "Phase design not found in the instructional design." });
        }

        const groupSize = phaseDesign.stdntAmount; // Expected group size
        const groupingAlgorithm = phaseDesign.grouping_algorithm; // Grouping strategy

        // Delete any existing groups for the current phase
        await GroupsHelper.deleteGroupsForPhase(phaseId);

        // Select the appropriate grouping algorithm
        const algorithm = GroupsHelper.groupingAlgorithms[groupingAlgorithm];
        if (!algorithm) {
            return res.status(400).json({ error: `Unsupported grouping algorithm: ${groupingAlgorithm}` });
        }

        // Compute groups using the selected algorithm
        const groups = await algorithm(sessionId, phases, groupSize);

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
                sqlParams: [rpg2.param('plain', sessionId), rpg2.param('plain', phaseId)],
            });

            let maskCode = 'A'.charCodeAt(0);

            for (const { uid } of group) {
                if (maskCode > 'Z'.charCodeAt(0)) {
                    throw new Error("Exceeded allowed characters for anon_mask.");
                }

                const mask = String.fromCharCode(maskCode);
                await rpg2.execSQL({
                    dbcon: config.dbconnString,
                    sql: `
                        INSERT INTO teamusers (tmid, uid, anon_mask)
                        VALUES ($1, $2, $3)
                    `,
                    sqlParams: [rpg2.param('plain', team.id), rpg2.param('plain', uid), 
                        rpg2.param('plain', mask)],
                });
                maskCode++;
            }
        }

        // Respond with success
        res.status(201).json({ message: "Groups successfully created." });
    } catch (error) {
        // Log and handle any errors that occur during group creation
        console.error("Error creating groups:", error);
        res.status(500).json({ error: "Error occurred while creating groups." });
    }
});

export default router;
