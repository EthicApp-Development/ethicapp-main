"use strict";

import express from "express";
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

const router = express.Router();

const designStatistics = {
    semantic_differential: computeSemanticDifferentialStats,
    ranking: computeRankingStats,
};

router.get("/phases/:id/stats", async (req, res) => {
    const { id: phaseId } = req.params;

    try {
        // Retrieve the design associated with the phase
        const designResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT d.design
                FROM designs d
                INNER JOIN activity a ON d.id = a.design
                INNER JOIN stages s ON a.session = s.sesid
                WHERE s.id = $1
            `,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        if (designResult.length === 0) {
            return res.status(404).json({ error: "Design not found for the specified phase." });
        }

        const design = designResult[0].design;
        const designType = design.type;

        // Validate if the design type has a corresponding statistics function
        const computeStats = designStatistics[designType];
        if (!computeStats) {
            return res.status(400).json({ error: `Unsupported design type: ${designType}` });
        }

        // Get the number of students in the session
        const studentsResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT COUNT(*) AS student_count
                FROM sesusers su
                INNER JOIN users u ON su.uid = u.id
                WHERE su.sesid = (SELECT sesid FROM stages WHERE id = $1)
                AND u.role = 'A'
            `,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        const expectedResponsesPerQuestion = Number(studentsResult[0].student_count);

        // Compute response statistics for the phase
        const responseStats = await computeStats(phaseId);

        // Return the statistics as JSON
        res.status(200).json({
            expectedResponsesPerQuestion,
            responseStats,
        });
    } catch (error) {
        console.error("Error retrieving phase statistics:", error);
        res.status(500).json({ error: "An error occurred while retrieving phase statistics." });
    }
});

/**
 * Compute statistics for a ranking design phase.
 * @param {number} stageId - The ID of the stage (phase).
 * @returns {Promise<Array>} - An array of response stats per question.
 */
async function computeRankingStats(stageId) {
    // Get the actors (roles) in the stage, along with justification requirement
    const actors = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT a.id AS actor_id, a.justified
            FROM actors a
            WHERE a.stageid = $1
            ORDER BY a.id
        `,
        sqlParams: [rpg2.param('plain', stageId)],
    });

    if (actors.length === 0) {
        throw new Error("No actors found for the specified stage.");
    }

    const totalActors = actors.length;

    // Count valid user responses, considering justification requirements
    const responses = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT asel.uid AS user_id, COUNT(*) AS response_count
            FROM actor_selection asel
            INNER JOIN actors a ON asel.actorid = a.id
            WHERE asel.stageid = $1
            AND (
                a.justified = false OR
                (asel.description IS NOT NULL AND TRIM(asel.description) != '')
            )
            GROUP BY asel.uid
            HAVING COUNT(*) = $2
        `,
        sqlParams: [rpg2.param('plain', stageId),
            rpg2.param('plain', totalActors)],
    });

    // Count distinct user IDs with valid responses
    const completedResponses = responses.length;

    // Return stats for each actor
    return actors.map((actor, index) => ({
        question: index + 1, // Index the actors as "questions"
        responses: completedResponses, // Each actor shares the same response count
    }));
}

/**
 * Compute statistics for a semantic differential design phase.
 * @param {number} stageId - The ID of the stage (phase).
 * @returns {Promise<Array>} - An array of response stats per question.
 */
async function computeSemanticDifferentialStats(stageId) {
    // Get the questions in the stage
    const questions = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT d.id AS question_id, d.justify
            FROM differential d
            WHERE d.stageid = $1
            ORDER BY d.id
        `,
        sqlParams: [rpg2.param('plain', stageId)],
    });

    if (questions.length === 0) {
        throw new Error("No questions found for the specified stage.");
    }

    // Compute response stats for each question
    const responseStats = await Promise.all(
        questions.map(async (q) => {
            const { question_id, justify } = q;

            // Count complete responses (consider justification if required)
            const responses = await rpg2.execSQL({
                dbcon: config.dbconnString,
                sql: `
                    SELECT COUNT(*) AS count
                    FROM differential_selection ds
                    WHERE ds.did = $1
                    AND (
                        $2 = false OR
                        (ds.comment IS NOT NULL AND TRIM(ds.comment) != '')
                    )
                `,
                sqlParams: [question_id, justify],
            });

            return {
                question: question_id,
                responses: Number(responses[0].count),
            };
        })
    );

    return responseStats;
}

export default router;

