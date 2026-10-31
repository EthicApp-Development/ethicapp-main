/**
 * The items of a phase, copied from the design's phase when the phase starts
 * (#906): the questions of a semantic differential (`differential`) and the
 * roles of a ranking (`actors`). Each design type has a builder, which turns
 * the design's phase into rows, and a statement that inserts them all at once,
 * in their order, on the client of the transaction that starts the phase.
 */
import { storedTextContentType } from "../../common/modules/text-content-types.js";

// $1-$8 one array per column, in the questions' order; $9 creator (the
// teacher), $10 phase id, $11 session id.
export const INSERT_DIFFERENTIAL_ITEMS_SQL = `
    INSERT INTO differential (
        title, title_content_type, tleft, tright, orden, num, justify, word_count,
        creator, stageid, sesid
    )
    SELECT item.title,
           item.title_content_type,
           item.tleft,
           item.tright,
           item.orden,
           item.num,
           item.justify,
           item.word_count,
           $9,
           $10,
           $11
    FROM unnest(
        $1::text[], $2::text[], $3::text[], $4::text[],
        $5::integer[], $6::integer[], $7::boolean[], $8::integer[]
    ) WITH ORDINALITY AS item (
        title, title_content_type, tleft, tright, orden, num, justify, word_count, position
    )
    ORDER BY item.position
`;

// $1-$4 one array per column, in the roles' order; $5 phase id.
export const INSERT_RANKING_ITEMS_SQL = `
    INSERT INTO actors (name, jorder, justified, word_count, stageid)
    SELECT item.name,
           item.jorder,
           item.justified,
           item.word_count,
           $5
    FROM unnest($1::text[], $2::boolean[], $3::boolean[], $4::integer[])
        WITH ORDINALITY AS item (name, jorder, justified, word_count, position)
    ORDER BY item.position
`;

/**
 * One row per question of a semantic differential phase. A content type the
 * design does not declare, or does not know, is stored as null and read as
 * text/plain (#763).
 */
export function semanticDifferentialItems(phase) {
    return (phase.questions ?? []).map((question, index) => {
        const format = question.ans_format ?? {};
        return {
            title:            question.q_text,
            titleContentType: storedTextContentType(question.q_text_content_type),
            tleft:            format.l_pole,
            tright:           format.r_pole,
            orden:            index + 1,
            num:              format.values,
            justify:          format.just_required,
            wordCount:        format.min_just_length,
        };
    });
}

/** One row per role of a ranking phase. */
export function rankingItems(phase) {
    return (phase.roles ?? []).map(role => ({
        name:      role.name,
        jorder:    role.type === "order",
        justified: role.type != null,
        wordCount: role.wc,
    }));
}

function column(items, key) {
    return items.map(item => item[key] ?? null);
}

async function insertSemanticDifferentialItems(client, { phase, phaseId, sessionId, teacherId }) {
    const items = semanticDifferentialItems(phase);
    if (items.length === 0) {
        return 0;
    }
    await client.query(INSERT_DIFFERENTIAL_ITEMS_SQL, [
        column(items, "title"),
        column(items, "titleContentType"),
        column(items, "tleft"),
        column(items, "tright"),
        column(items, "orden"),
        column(items, "num"),
        column(items, "justify"),
        column(items, "wordCount"),
        teacherId,
        phaseId,
        sessionId,
    ]);
    return items.length;
}

async function insertRankingItems(client, { phase, phaseId }) {
    const items = rankingItems(phase);
    if (items.length === 0) {
        return 0;
    }
    await client.query(INSERT_RANKING_ITEMS_SQL, [
        column(items, "name"),
        column(items, "jorder"),
        column(items, "justified"),
        column(items, "wordCount"),
        phaseId,
    ]);
    return items.length;
}

/**
 * The item writer of each design type. Each one inserts the items of the
 * design's phase into phase `phaseId` and resolves to how many it inserted.
 *
 * @type {Record<string, (client: { query: Function }, item: {
 *     phase: Object, phaseId: number, sessionId: number, teacherId: number
 * }) => Promise<number>>}
 */
export const phaseItemWriters = Object.freeze({
    semantic_differential: insertSemanticDifferentialItems,
    ranking:               insertRankingItems,
});
