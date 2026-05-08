import * as config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";
import * as Yup from "yup";
import { getDesignTypeByPhaseId } from "./designs-helper.js";

const flatChatMessageSchema = Yup.object({
    userId: Yup.number().integer().positive().nullable(),
    externalAgentId: Yup.number().integer().positive().nullable(),
    phaseId: Yup.number().integer().positive().required(),
    questionId: Yup.number().integer().positive().nullable(),
    groupId: Yup.number().integer().positive().nullable(),
    parentId: Yup.number().integer().positive().nullable(),
    content: Yup.string().trim().min(1).max(2000).required(),
}).test(
    "human-or-external-author",
    "A chat message requires either userId or externalAgentId.",
    value => Boolean(value?.userId || value?.externalAgentId)
);
const nestedChatMessageSchema = Yup.object({
    header: Yup.object({
        userId: Yup.number().integer().positive(),
        uid: Yup.number().integer().positive(),
        externalAgentId: Yup.number().integer().positive().nullable(),
        phaseId: Yup.number().integer().positive(),
        stageId: Yup.number().integer().positive(),
        itemId: Yup.number().integer().positive().nullable(),
        questionId: Yup.number().integer().positive().nullable(),
        groupId: Yup.number().integer().positive().nullable(),
    }).required(),
    payload: Yup.object({
        parentId: Yup.number().integer().positive().nullable(),
        parent_id: Yup.number().integer().positive().nullable(),
        content: Yup.string().trim().min(1).max(2000).required(),
    }).required(),
});

function normalizeChatMessageInput(data) {
    if (data?.header && data?.payload) {
        const rawUserId = data.header.userId ?? data.header.uid;
        const userId = rawUserId == null ? null : Number(rawUserId);
        const phaseId = Number(data.header.phaseId ?? data.header.stageId);
        const questionId = Number(data.header.questionId ?? data.header.itemId);
        const parentId = data.payload.parentId ?? data.payload.parent_id ?? null;
        const content = data.payload.content;

        return {
            userId,
            externalAgentId: data.header.externalAgentId == null
                ? null
                : Number(data.header.externalAgentId),
            phaseId,
            questionId: Number.isFinite(questionId) ? questionId : null,
            groupId: data.header.groupId == null ? null : Number(data.header.groupId),
            parentId,
            content,
        };
    }

    return {
        userId: data?.userId == null ? null : Number(data.userId),
        externalAgentId: data?.externalAgentId == null ? null : Number(data.externalAgentId),
        phaseId: Number(data?.phaseId),
        questionId: data?.questionId == null ? null : Number(data.questionId),
        groupId: data?.groupId == null ? null : Number(data.groupId),
        parentId: data?.parentId ?? null,
        content: data?.content,
    };
}

/**
 * Handlers for message count queries based on design type.
 */
export const messageCountHandlers = {
    semantic_differential: countSemanticDifferentialMessages,
    ranking: countRankingMessages,
};

// Handlers for fetching chat transcript based on design type
export const chatTranscriptHandlers = {
    ranking: rankingChatTranscriptByGroup,
    semantic_differential: semanticDifferentialChatTranscriptByGroup,
};

export const chatInsertHandlers = {
    ranking: async ({ userId, externalAgentId, phaseId, groupId, content, parentId, dbcon }) => {
        const result = await rpg2.execSQL({
            sql: `
                INSERT INTO chat (uid, external_agent_id, stageid, tmid, content, parent_id)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, uid, external_agent_id, stageid, tmid, content, stime, parent_id
            `,
            dbcon,
            sqlParams: [rpg2.param('plain', userId) || null,
                rpg2.param('plain', externalAgentId) || null, rpg2.param('plain', phaseId),
                rpg2.param('plain', groupId) || null, rpg2.param('plain', content),
                rpg2.param('plain', parentId) || null],
        });

        return result[0] || null;
    },

    semantic_differential: async ({
        userId,
        externalAgentId,
        questionId,
        groupId,
        content,
        parentId,
        dbcon
    }) => {
        const result = await rpg2.execSQL({
            sql: `
                INSERT INTO differential_chat (uid, external_agent_id, did, tmid, content, parent_id)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, uid, external_agent_id, did, tmid, content, stime, parent_id
            `,
            dbcon,
            sqlParams: [rpg2.param('plain', userId) || null,
                rpg2.param('plain', externalAgentId) || null, rpg2.param('plain', questionId),
                rpg2.param('plain', groupId) || null,
                rpg2.param('plain', content),
                rpg2.param('plain', parentId) || null],
        });

        return result[0] || null;
    },
};

export const saveChatMessage = async function(data) {
    try {
        if (data?.header && data?.payload) {
            await nestedChatMessageSchema.validate(data, { abortEarly: false, stripUnknown: true });
        }

        const normalizedData = normalizeChatMessageInput(data);
        const validatedData = await flatChatMessageSchema.validate(normalizedData, {
            abortEarly: false,
            stripUnknown: true,
        });

        const { userId, externalAgentId, phaseId, questionId, groupId, parentId, content } = validatedData;

        const designType = await getDesignTypeByPhaseId(phaseId);
        const handler = chatInsertHandlers[designType];
        if (!handler) {
            throw new Error(`Unsupported design type: ${designType}`);
        }

        const savedMessage = await handler({
            userId,
            externalAgentId,
            phaseId,
            questionId,
            groupId,
            content,
            parentId,
            dbcon: config.dbconnString,
        });

        return savedMessage || true;
    } catch(error) {
        console.error("[ChatHelper::saveChatMessage] Could not save the message. ", error);
        return false;
    }
}

async function countSemanticDifferentialMessages(phaseId) {
    const results = await rpg2.execSQL({
        sql: `
            SELECT c.did,
                   c.uid,
                   COALESCE(c.tmid, u.tmid) AS tmid,
                   COUNT(*) AS message_count
            FROM differential_chat AS c
            LEFT JOIN teamusers AS u
                ON u.uid = c.uid
               AND (c.tmid IS NULL OR c.tmid = u.tmid)
            INNER JOIN differential AS d
                ON d.id = c.did
            INNER JOIN teams AS tm
                ON tm.id = COALESCE(c.tmid, u.tmid)
            WHERE d.stageid = $1
              AND tm.stageid = $1
            GROUP BY c.did, c.uid, COALESCE(c.tmid, u.tmid)
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param('plain', phaseId)],
    });

    return results.map(row => ({
        questionId: row.did,
        userId: row.uid,
        teamId: row.tmid,
        messageCount: parseInt(row.message_count, 10),
    }));
}

async function countRankingMessages(phaseId) {
    const results = await rpg2.execSQL({
        sql: `
            SELECT c.stageid,
                   c.uid,
                   COALESCE(c.tmid, u.tmid) AS tmid,
                   COUNT(*) AS message_count
            FROM chat AS c
            LEFT JOIN teamusers AS u
                ON u.uid = c.uid
               AND (c.tmid IS NULL OR c.tmid = u.tmid)
            INNER JOIN teams AS tm
                ON tm.id = COALESCE(c.tmid, u.tmid)
            WHERE c.stageid = $1
              AND tm.stageid = $1
            GROUP BY c.stageid, c.uid, COALESCE(c.tmid, u.tmid)
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param('plain', phaseId)],
    });

    return results.map(row => ({
        phaseId: row.stageid,
        userId: row.uid,
        teamId: row.tmid,
        messageCount: parseInt(row.message_count, 10),
    }));
}

async function semanticDifferentialChatTranscriptByGroup(groupId, questionId) {
    return await rpg2.execSQL({
        sql: `
            SELECT c.id,
                   c.uid,
                   CASE
                       WHEN esa.id IS NOT NULL THEN 'external_service'
                       ELSE u.role
                   END AS author_role,
                   COALESCE(esa.display_name, u.name) AS author_name,
                   esa.service_id AS external_service_id,
                   c.content,
                   c.stime,
                   c.parent_id
            FROM differential_chat AS c
            LEFT JOIN users AS u
                ON u.id = c.uid
            LEFT JOIN external_service_agents AS esa
                ON esa.id = c.external_agent_id
            WHERE c.did = $1
              AND (
                  c.tmid = $2
                  OR (
                      c.tmid IS NULL
                      AND c.uid IN (
                          SELECT tu.uid
                          FROM teamusers AS tu
                          WHERE tu.tmid = $2
                      )
                  )
              )
            ORDER BY c.stime ASC
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param('plain', questionId), rpg2.param('plain', groupId)],
    });
}

async function rankingChatTranscriptByGroup(groupId, questionId) {
    return await rpg2.execSQL({
        sql: `
            SELECT s.id,
                   s.uid,
                   CASE
                       WHEN esa.id IS NOT NULL THEN 'external_service'
                       ELSE u.role
                   END AS author_role,
                   COALESCE(esa.display_name, u.name) AS author_name,
                   esa.service_id AS external_service_id,
                   s.content,
                   s.stime,
                   s.parent_id
            FROM chat AS s
            LEFT JOIN users AS u
                ON u.id = s.uid
            LEFT JOIN external_service_agents AS esa
                ON esa.id = s.external_agent_id
            WHERE s.stageid = (
                SELECT stageid
                FROM teams
                WHERE id = $1
            )
              AND (
                  s.tmid = $1
                  OR (
                      s.tmid IS NULL
                      AND s.uid IN (
                          SELECT tu.uid
                          FROM teamusers AS tu
                          WHERE tu.tmid = $1
                      )
                  )
              )
            ORDER BY s.stime ASC
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param('plain', groupId)],
    });
}
