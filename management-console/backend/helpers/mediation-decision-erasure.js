// What forgetting a participant does to the stored mediation decisions of AI
// services (#1222, epic ethicapp-ai-additions#293).
//
// A `mediation-decision/v1` record (ethicapp's
// external_service_mediation_decisions, V46) references the messages it
// evaluated by id only, but its `reason` is model text about the
// conversation: Polyadic's Validator may name a participant, or quote or
// paraphrase what they wrote. The record is room-level work (no user), so
// the payload erasure, which works by user id, does not reach it.
//
// The step therefore redacts the reasons the way Polyadic redacts agent
// replies when EthicApp forgets a participant (ethicapp-ai-additions #214,
// polyadic-agents/backend/app/participant_data.py, "Participant data and
// erasure" in its README): in each group the participant wrote in, their
// names and the verbatim fragments of their messages there are replaced by
// the placeholder. The same text is redacted in the callback's stored
// raw_payload, which keeps the records as Polyadic sent them.
//
// It must run inside the anonymization step, before the step replaces the
// participant's messages and names: those are the redaction terms, and the
// `user-forgotten` request that follows the commit no longer has them.

// Display names shorter than this are not redacted inside other text:
// EthicApp's anonymous masks are a single letter, which identifies nobody and
// would otherwise match ordinary words ("A", "Y").
export const MIN_REDACTED_NAME_LENGTH = 2;
// Words of a multi-word name ("María José") are redacted on their own from
// this length, because agents often address a participant by one of them.
export const MIN_REDACTED_NAME_PART_LENGTH = 3;
// A run of this many consecutive words taken from one of the participant's
// messages is a verbatim fragment of it. Shorter runs are routinely shared
// by chance in a discussion of one case.
export const MIN_QUOTED_FRAGMENT_WORDS = 6;

// A word as Python's `\w` matches it in Polyadic: letters, digits, `_`.
const WORD_PATTERN = /[\p{L}\p{N}_]+/gu;
const WORD_CHARACTER = "[\\p{L}\\p{N}_]";

// Words of `text` as { word (lower case), start, end }.
function wordsOf(text) {
    return [...text.matchAll(WORD_PATTERN)].map(match => ({
        word:  match[0].toLowerCase(),
        start: match.index,
        end:   match.index + match[0].length,
    }));
}

// The name AgentScope messages carry, as Polyadic computes it.
function sanitizedAgentName(name) {
    return name.replace(/[<|\\/>]/gu, "").replace(/\s+/gu, "_");
}

function byLengthThenText(left, right) {
    return right.length - left.length || (left < right ? -1 : left > right ? 1 : 0);
}

/**
 * The redaction terms of one group: the participant's names (and their
 * variants), longest first, and their messages there as lower-case word
 * sequences, for the fragments.
 *
 * @param {Iterable<string|null>} displayNames
 * @param {Iterable<string|null>} contents
 * @returns {{ names: string[], sources: string[][] }}
 */
export function redactionTerms(displayNames, contents) {
    const names = new Set();
    for (const rawName of displayNames) {
        const name = typeof rawName === "string" ? rawName.trim() : "";
        if (name.length < MIN_REDACTED_NAME_LENGTH) {
            continue;
        }
        names.add(name);
        const sanitized = sanitizedAgentName(name);
        if (sanitized.length >= MIN_REDACTED_NAME_LENGTH) {
            names.add(sanitized);
        }
        for (const part of name.split(/[\s_]+/u)) {
            if (part.length >= MIN_REDACTED_NAME_PART_LENGTH) {
                names.add(part);
            }
        }
    }

    const sources = new Map();
    for (const content of contents) {
        const words = wordsOf(typeof content === "string" ? content : "").map(({ word }) => word);
        if (words.length >= MIN_QUOTED_FRAGMENT_WORDS) {
            sources.set(words.join(" "), words);
        }
    }
    return { names: [...names].sort(byLengthThenText), sources: [...sources.values()] };
}

/**
 * Character spans of `text` that quote one of `sources` verbatim: runs of at
 * least MIN_QUOTED_FRAGMENT_WORDS consecutive words equal to consecutive
 * words of a source, ignoring case, spacing and punctuation. A word cut at
 * either end of the run is covered too. Overlapping spans are merged.
 */
export function quotedFragmentSpans(text, sources) {
    const target = wordsOf(text);
    const targetWords = target.map(({ word }) => word);
    const spans = [];
    for (const source of sources) {
        const positions = new Map();
        source.forEach((word, j) => positions.set(word, [...(positions.get(word) ?? []), j]));
        targetWords.forEach((word, i) => {
            for (const j of positions.get(word) ?? []) {
                if (i > 0 && j > 0 && targetWords[i - 1] === source[j - 1]) {
                    continue; // not the start of a maximal run
                }
                let length = 0;
                while (i + length < targetWords.length && j + length < source.length
                    && targetWords[i + length] === source[j + length]) {
                    length += 1;
                }
                if (length < MIN_QUOTED_FRAGMENT_WORDS) {
                    continue;
                }
                let first = i;
                let last = i + length - 1;
                if (i > 0 && j > 0 && source[j - 1].endsWith(targetWords[i - 1])) {
                    first = i - 1;
                }
                if (i + length < targetWords.length && j + length < source.length
                    && source[j + length].startsWith(targetWords[i + length])) {
                    last = i + length;
                }
                spans.push([target[first].start, target[last].end]);
            }
        });
    }

    const merged = [];
    for (const [start, end] of spans.sort((left, right) => left[0] - right[0] || left[1] - right[1])) {
        const previous = merged.at(-1);
        if (previous && start <= previous[1]) {
            previous[1] = Math.max(previous[1], end);
        } else {
            merged.push([start, end]);
        }
    }
    return merged;
}

function escapeRegExp(text) {
    return text.replace(/[\\^$.*+?()[\]{}|/]/gu, "\\$&");
}

// Names match case-sensitively and only as whole words: "Ana" leaves
// "Analyst" alone.
function redactNames(text, names, placeholder) {
    if (names.length === 0) {
        return text;
    }
    const pattern = names
        .map(name => `(?<!${WORD_CHARACTER})${escapeRegExp(name)}(?!${WORD_CHARACTER})`)
        .join("|");
    return text.replace(new RegExp(pattern, "gu"), () => placeholder);
}

function redactFragments(text, sources, placeholder) {
    if (sources.length === 0) {
        return text;
    }
    let cursor = 0;
    let redacted = "";
    for (const [start, end] of quotedFragmentSpans(text, sources)) {
        redacted += text.slice(cursor, start) + placeholder;
        cursor = end;
    }
    return redacted + text.slice(cursor);
}

/**
 * `text` with the quoted fragments, then the names, of `terms` replaced by
 * `placeholder`; any other value unchanged.
 */
export function redactText(text, terms, placeholder) {
    if (typeof text !== "string" || text === ""
        || (terms.names.length === 0 && terms.sources.length === 0)) {
        return text;
    }
    return redactNames(redactFragments(text, terms.sources, placeholder), terms.names, placeholder);
}

function jsonParam(value) {
    return JSON.stringify(value);
}

// The callback payload with the reasons of the given decisions replaced, or
// null when nothing changes.
function redactedRawPayload(rawPayload, reasons) {
    const decisions = rawPayload?.decisions;
    if (!Array.isArray(decisions)) {
        return null;
    }
    let changed = false;
    const next = decisions.map(record => {
        const decisionId = record?.decisionId;
        if (typeof decisionId !== "string" || !reasons.has(decisionId)
            || record.reason === reasons.get(decisionId)) {
            return record;
        }
        changed = true;
        return { ...record, reason: reasons.get(decisionId) };
    });
    return changed ? { ...rawPayload, decisions: next } : null;
}

/**
 * Redacts the reasons of the stored mediation decisions of every group the
 * user wrote in, and the same reasons in their callbacks' raw payloads.
 * Only rows that change are written.
 *
 * @param {{ query: Function }} client - A client inside the step's
 *     transaction, which has locked the account.
 * @param {number} userId
 * @param {string} placeholderText
 * @returns {Promise<{ decisions: number, results: number }>} Rows changed.
 */
export async function redactMediationDecisionReasons(client, userId, placeholderText) {
    const messages = await client.query(
        `
            SELECT tmid AS group_id, content
            FROM differential_chat
            WHERE uid = $1
              AND tmid IS NOT NULL
              AND content IS NOT NULL
            UNION ALL
            SELECT tmid AS group_id, content
            FROM chat
            WHERE uid = $1
              AND tmid IS NOT NULL
              AND content IS NOT NULL
        `,
        [userId]
    );
    const contentsByGroup = new Map();
    for (const row of messages.rows) {
        contentsByGroup.set(row.group_id, [...(contentsByGroup.get(row.group_id) ?? []), row.content]);
    }
    const groupIds = [...contentsByGroup.keys()];
    if (groupIds.length === 0) {
        return { decisions: 0, results: 0 };
    }

    const decisionRows = await client.query(
        `
            SELECT id, group_id, result_id, decision_id::text AS decision_id,
                   record ->> 'reason' AS reason
            FROM external_service_mediation_decisions
            WHERE group_id = ANY($1::integer[])
            ORDER BY id
            FOR UPDATE
        `,
        [groupIds]
    );
    if (decisionRows.rows.length === 0) {
        return { decisions: 0, results: 0 };
    }

    const identity = (await client.query(
        `
            SELECT firstname, lastname, name
            FROM users
            WHERE id = $1
        `,
        [userId]
    )).rows[0] ?? {};
    // The names the rooms could show: Polyadic receives the first name, or the
    // team's one-letter mask in an anonymous phase, which identifies nobody
    // and is never redacted (MIN_REDACTED_NAME_LENGTH).
    const names = [identity.firstname, identity.lastname, identity.name];
    const termsByGroup = new Map();
    const termsOf = groupId => {
        if (!termsByGroup.has(groupId)) {
            termsByGroup.set(groupId, redactionTerms(names, contentsByGroup.get(groupId) ?? []));
        }
        return termsByGroup.get(groupId);
    };

    let decisions = 0;
    const reasonsByResult = new Map();
    for (const row of decisionRows.rows) {
        const redacted = redactText(row.reason, termsOf(row.group_id), placeholderText);
        if (redacted === row.reason) {
            continue;
        }
        await client.query(
            `
                UPDATE external_service_mediation_decisions
                SET record = jsonb_set(record, '{reason}', to_jsonb($2::text))
                WHERE id = $1
            `,
            [row.id, redacted]
        );
        decisions += 1;
        if (row.result_id) {
            const reasons = reasonsByResult.get(row.result_id) ?? new Map();
            reasons.set(row.decision_id, redacted);
            reasonsByResult.set(row.result_id, reasons);
        }
    }

    let results = 0;
    if (reasonsByResult.size > 0) {
        const resultRows = await client.query(
            `
                SELECT id, raw_payload
                FROM external_service_results
                WHERE id = ANY($1::uuid[])
                FOR UPDATE
            `,
            [[...reasonsByResult.keys()]]
        );
        for (const row of resultRows.rows) {
            const payload = redactedRawPayload(row.raw_payload, reasonsByResult.get(row.id) ?? new Map());
            if (!payload) {
                continue;
            }
            await client.query(
                `
                    UPDATE external_service_results
                    SET raw_payload = $2::jsonb
                    WHERE id = $1
                `,
                [row.id, jsonParam(payload)]
            );
            results += 1;
        }
    }

    return { decisions, results };
}
