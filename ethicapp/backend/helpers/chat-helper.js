import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import * as Yup from "yup";
import { getDesignTypeByPhaseId } from "./designs-helper.js";

const flatChatMessageSchema = Yup.object({
    userId: Yup.number().integer().positive().required(),
    phaseId: Yup.number().integer().positive().required(),
    questionId: Yup.number().integer().positive().nullable(),
    groupId: Yup.number().integer().positive().nullable(),
    parentId: Yup.number().integer().positive().nullable(),
    content: Yup.string().trim().min(1).max(2000).required(),
});

const nestedChatMessageSchema = Yup.object({
    header: Yup.object({
        userId: Yup.number().integer().positive(),
        uid: Yup.number().integer().positive(),
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
        const userId = Number(data.header.userId ?? data.header.uid);
        const phaseId = Number(data.header.phaseId ?? data.header.stageId);
        const questionId = Number(data.header.questionId ?? data.header.itemId);
        const parentId = data.payload.parentId ?? data.payload.parent_id ?? null;
        const content = data.payload.content;

        return {
            userId,
            phaseId,
            questionId: Number.isFinite(questionId) ? questionId : null,
            groupId: data.header.groupId == null ? null : Number(data.header.groupId),
            parentId,
            content,
        };
    }

    return {
        userId: Number(data?.userId),
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
    ranking: async ({ userId, phaseId, groupId, content, parentId, dbcon }) => {
        const result = await rpg2.execSQL({
            sql: `
                INSERT INTO chat (uid, phase_id, group_id, content, parent_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id, uid, phase_id, group_id, content, stime, parent_id
            `,
            dbcon,
            sqlParams: [rpg2.param('plain', userId), rpg2.param('plain', phaseId),
                rpg2.param('plain', groupId) || null, rpg2.param('plain', content),
                rpg2.param('plain', parentId) || null],
        });

        return result[0] || null;
    },

    semantic_differential: async ({ userId, questionId, groupId, content, parentId, dbcon }) => {
        const result = await rpg2.execSQL({
            sql: `
                INSERT INTO differential_chat (uid, did, group_id, content, parent_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id, uid, did, group_id, content, stime, parent_id
            `,
            dbcon,
            sqlParams: [rpg2.param('plain', userId),
                rpg2.param('plain', questionId), rpg2.param('plain', groupId) || null,
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

        const { userId, phaseId, questionId, groupId, parentId, content } = validatedData;

        const designType = await getDesignTypeByPhaseId(phaseId);
        const handler = chatInsertHandlers[designType];
        if (!handler) {
            throw new Error(`Unsupported design type: ${designType}`);
        }

        const savedMessage = await handler({
            userId,
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
                   COALESCE(c.group_id, u.group_id) AS group_id,
                   COUNT(*) AS message_count
            FROM differential_chat AS c
            LEFT JOIN groups_users AS u
                ON u.user_id = c.uid
               AND (c.group_id IS NULL OR c.group_id = u.group_id)
            INNER JOIN differential AS d
                ON d.id = c.did
            INNER JOIN groups AS tm
                ON tm.id = COALESCE(c.group_id, u.group_id)
            WHERE d.phase_id = $1
              AND tm.phase_id = $1
            GROUP BY c.did, c.uid, COALESCE(c.group_id, u.group_id)
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param('plain', phaseId)],
    });

    return results.map(row => ({
        questionId: row.did,
        userId: row.uid,
        teamId: row.group_id,
        messageCount: parseInt(row.message_count, 10),
    }));
}

async function countRankingMessages(phaseId) {
    const results = await rpg2.execSQL({
        sql: `
            SELECT c.phase_id,
                   c.uid,
                   COALESCE(c.group_id, u.group_id) AS group_id,
                   COUNT(*) AS message_count
            FROM chat AS c
            LEFT JOIN groups_users AS u
                ON u.user_id = c.uid
               AND (c.group_id IS NULL OR c.group_id = u.group_id)
            INNER JOIN groups AS tm
                ON tm.id = COALESCE(c.group_id, u.group_id)
            WHERE c.phase_id = $1
              AND tm.phase_id = $1
            GROUP BY c.phase_id, c.uid, COALESCE(c.group_id, u.group_id)
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param('plain', phaseId)],
    });

    return results.map(row => ({
        phaseId: row.phase_id,
        userId: row.uid,
        teamId: row.group_id,
        messageCount: parseInt(row.message_count, 10),
    }));
}

async function semanticDifferentialChatTranscriptByGroup(groupId, questionId) {
    return await rpg2.execSQL({
        sql: `
            SELECT c.id,
                   c.uid,
                   u.role AS author_role,
                   u.name AS author_name,
                   c.content,
                   c.stime,
                   c.parent_id
            FROM differential_chat AS c
            INNER JOIN users AS u
                ON u.id = c.uid
            WHERE c.did = $1
              AND (
                  c.group_id = $2
                  OR (
                      c.group_id IS NULL
                      AND c.uid IN (
                          SELECT tu.user_id
                          FROM groups_users AS tu
                          WHERE tu.group_id = $2
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
                   u.role AS author_role,
                   u.name AS author_name,
                   s.content,
                   s.stime,
                   s.parent_id
            FROM chat AS s
            INNER JOIN users AS u
                ON u.id = s.uid
            WHERE s.phase_id = (
                SELECT phase_id
                FROM groups
                WHERE id = $1
            )
              AND (
                  s.group_id = $1
                  OR (
                      s.group_id IS NULL
                      AND s.uid IN (
                          SELECT tu.user_id
                          FROM groups_users AS tu
                          WHERE tu.group_id = $1
                      )
                  )
              )
            ORDER BY s.stime ASC
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param('plain', groupId)],
    });
}
