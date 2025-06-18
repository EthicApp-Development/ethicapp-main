import * as config from "../api/v2/config/config.json"; 
import * as rpg2 from "../db/rest-pg-2.js";
import { getDesignTypeByPhaseId } from "./desings-helper.js";
import { ChatMessage, ChatRoom } from "../api/v2/models";

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
    ranking: async ({ userId, phaseId, content, parentId, dbcon }) => {
        await rpg2.execSQL({
            sql: `
                INSERT INTO chat (uid, stageid, content, parent_id)
                VALUES ($1, $2, $3, $4)
            `,
            dbcon,
            sqlParams: [rpg2.param('plain', userId), rpg2.param('plain', phaseId), 
                rpg2.param('plain', content), rpg2.param('plain', parentId) || null],
        });
    },

    semantic_differential: async ({ userId, questionId, content, parentId, dbcon }) => {
        await rpg2.execSQL({
            sql: `
                INSERT INTO differential_chat (uid, did, content, parent_id)
                VALUES ($1, $2, $3, $4)
            `,
            dbcon,
            sqlParams: [rpg2.param('plain', userId), 
                rpg2.param('plain', questionId), rpg2.param('plain', content),
                rpg2.param('plain', parentId) || null],
        });
    },
};

export const saveChatMessage = async function(data) {
  try {
    console.log("[ChatHelper::saveChatMessage] Received data:", data);
    const { userId, chatRoomId } = data.header;
    const { content, parentId } = data.payload;

    //imprimir el tipo de los valores
    console.log("[ChatHelper::saveChatMessage] userId:", typeof userId, "chatRoomId:", typeof chatRoomId, "content:", typeof content, "parentId:", typeof parentId);
    await ChatMessage.create({
      chatroom_id: chatRoomId,
      user_id: userId,
      content,
      parent_id: parentId || null
    });
    console.log("[ChatHelper::saveChatMessage] Message saved successfully");
    return true;
  } catch (error) {
    console.error("[ChatHelper::saveChatMessage] Error:", error);
    return false;
  }
};

async function countSemanticDifferentialMessages(phaseId) {
    const results = await rpg2.execSQL({
        sql: `
            SELECT c.did,
                   u.uid,
                   u.tmid,
                   COUNT(*) AS message_count
            FROM differential_chat AS c
            INNER JOIN teamusers AS u
                ON u.uid = c.uid
            INNER JOIN differential AS d
                ON d.id = c.did
            INNER JOIN teams AS tm
                ON tm.id = u.tmid
            WHERE d.stageid = $1
              AND tm.stageid = $1
            GROUP BY c.did, u.uid, u.tmid
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
                   u.uid,
                   u.tmid,
                   COUNT(*) AS message_count
            FROM chat AS c
            INNER JOIN teamusers AS u
                ON u.uid = c.uid
            INNER JOIN teams AS tm
                ON tm.id = u.tmid
            WHERE c.stageid = $1
              AND tm.stageid = $1
            GROUP BY c.stageid, u.uid, u.tmid
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
                   c.content,
                   c.stime,
                   c.parent_id
            FROM differential_chat AS c
            WHERE c.did = $1
              AND c.uid IN (
                  SELECT tu.uid
                  FROM teamusers AS tu
                  WHERE tu.tmid = $2
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
                   s.content,
                   s.stime,
                   s.parent_id
            FROM chat AS s
            WHERE s.stageid = (
                SELECT stageid
                FROM teams
                WHERE id = $1
            )
              AND s.uid IN (
                  SELECT tu.uid
                  FROM teamusers AS tu
                  WHERE tu.tmid = $1
              )
            ORDER BY s.stime ASC
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param('plain', groupId)],
    });
}