// YouTube videos owned by a case (#781, epic #779).
//
// A case stores only its ordered video ids (ethical_case_videos, V19). This
// module parses the ids a teacher submits, checks the new ones against YouTube
// before they are saved, shapes the videos for the case API and writes or
// copies the rows. YouTube metadata comes from the metadata service of #780,
// which callers inject together with its `videoAvailability` mapping, and the
// queries run on a pg client or pool the caller passes. Nothing here connects
// to PostgreSQL, Redis or YouTube by itself.
import { canonicalYoutubeUrl, isYoutubeVideoId } from "../../common/modules/youtube-urls.js";

/** At most this many videos per case: one metadata request checks them all. */
export const MAX_CASE_VIDEOS = 50;

export const CASE_VIDEO_ERROR_CODES = Object.freeze({
    invalid:       "CASE_VIDEOS_INVALID",
    rejected:      "CASE_VIDEOS_REJECTED",
    notConfigured: "CASE_VIDEOS_NOT_CONFIGURED",
    unavailable:   "CASE_VIDEOS_UNAVAILABLE",
});

const REJECTED_AVAILABILITIES = new Set(["private", "not_embeddable"]);

/**
 * A subquery for the ordered `[{ youtubeVideoId, position }]` of the case
 * aliased `caseAlias`, as JSON. Listings read it in the same query as the
 * case, so they need neither another query per case nor YouTube.
 */
export function caseVideosJsonSql(caseAlias = "c") {
    return `COALESCE((
        SELECT json_agg(json_build_object(
            'youtubeVideoId', ecv.youtube_video_id,
            'position', ecv.position
        ) ORDER BY ecv.position)
        FROM ethical_case_videos ecv
        WHERE ecv.case_id = ${caseAlias}.id
    ), '[]'::json)`;
}

/** The `[{ youtubeVideoId, position }]` of listings, from a row's JSON column. */
export function normalizeCaseVideoSummaries(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter(video => isYoutubeVideoId(video?.youtubeVideoId))
        .map(video => ({
            youtubeVideoId: video.youtubeVideoId,
            position:       Number(video.position),
        }))
        .sort((left, right) => left.position - right.position);
}

/** Summaries numbered from 1, in the order of `videoIds`. */
export function caseVideoSummariesFromIds(videoIds) {
    return videoIds.map((youtubeVideoId, index) => ({ youtubeVideoId, position: index + 1 }));
}

function invalidVideos(fields) {
    return {
        ok:     false,
        status: 400,
        body:   {
            status:  "err",
            message: "Invalid case videos.",
            code:    CASE_VIDEO_ERROR_CODES.invalid,
            fields,
        },
    };
}

/**
 * The `videos` field of a case create or update: a JSON array of YouTube video
 * ids, in order. Returns `{ ok: true, provided: false }` when the field is
 * absent, which leaves an existing case's videos unchanged, and
 * `{ ok: true, provided: true, ids }` otherwise, where an empty list removes
 * every video. A repeated id keeps its first place. Malformed input returns
 * `{ ok: false, status, body }`, with `body.fields` mapping each bad id to
 * `invalid_id`, or `videos` to `invalid` or `too_many`.
 */
export function parseCaseVideoIds(value) {
    if (value === undefined || value === null) {
        return { ok: true, provided: false };
    }

    let parsed = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value);
        } catch {
            return invalidVideos({ videos: "invalid" });
        }
    }

    if (!Array.isArray(parsed)) {
        return invalidVideos({ videos: "invalid" });
    }

    const fields = {};
    for (const id of parsed) {
        if (!isYoutubeVideoId(id)) {
            fields[String(id)] = "invalid_id";
        }
    }
    if (Object.keys(fields).length > 0) {
        return invalidVideos(fields);
    }

    const ids = Array.from(new Set(parsed));
    if (ids.length > MAX_CASE_VIDEOS) {
        return invalidVideos({ videos: "too_many" });
    }

    return { ok: true, provided: true, ids };
}

/**
 * What saving `requestedIds` does to a case holding `currentIds`: the ids it
 * adds (the only ones to check on YouTube), the ids it removes, and whether
 * the list changes at all, order included.
 */
export function planCaseVideoChanges(currentIds, requestedIds) {
    const current = new Set(currentIds);
    const requested = new Set(requestedIds);

    return {
        newIds:     requestedIds.filter(id => !current.has(id)),
        removedIds: currentIds.filter(id => !requested.has(id)),
        changed:    currentIds.length !== requestedIds.length
            || currentIds.some((id, index) => id !== requestedIds[index]),
    };
}

function rejectionOf(entry, videoAvailability) {
    if (entry?.status === "not_found") {
        return "not_found";
    }
    if (entry?.status === "found") {
        const availability = videoAvailability(entry);
        return REJECTED_AVAILABILITIES.has(availability) ? availability : null;
    }
    return null;
}

/**
 * Checks the ids a case does not hold yet against YouTube: each must exist, not
 * be private and be embeddable. Ids the case already holds are not checked
 * again, so a case keeps a video that later went private.
 *
 * Returns `{ ok: true }`, or `{ ok: false, status, body }` where `body.fields`
 * maps each failing id to its reason:
 * - 400 `CASE_VIDEOS_NOT_CONFIGURED` (`not_configured`) without a Google key;
 * - 400 `CASE_VIDEOS_REJECTED` (`not_found`, `private`, `not_embeddable`);
 * - 503 `CASE_VIDEOS_UNAVAILABLE` (`unavailable`) when YouTube cannot be
 *   reached for some id and none was rejected, so no unchecked id is saved.
 */
export async function checkNewCaseVideos(newIds, { metadataService, videoAvailability }) {
    if (newIds.length === 0) {
        return { ok: true };
    }

    const notConfigured = () => ({
        ok:     false,
        status: 400,
        body:   {
            status:  "err",
            message: "Video support is not configured.",
            code:    CASE_VIDEO_ERROR_CODES.notConfigured,
            fields:  Object.fromEntries(newIds.map(id => [id, "not_configured"])),
        },
    });

    if (!metadataService.isConfigured()) {
        return notConfigured();
    }

    let entries;
    try {
        entries = await metadataService.getVideoMetadata(newIds);
    } catch (error) {
        console.error("Unable to check case videos on YouTube:", error);
        entries = new Map();
    }

    const rejected = {};
    const unavailable = {};
    let configured = true;
    for (const id of newIds) {
        const entry = entries.get(id);
        if (entry?.status === "not_configured") {
            configured = false;
            continue;
        }
        const rejection = rejectionOf(entry, videoAvailability);
        if (rejection) {
            rejected[id] = rejection;
        } else if (entry?.status !== "found") {
            unavailable[id] = "unavailable";
        }
    }

    if (!configured) {
        return notConfigured();
    }

    if (Object.keys(rejected).length > 0) {
        return {
            ok:     false,
            status: 400,
            body:   {
                status:  "err",
                message: "Some videos cannot be added to the case.",
                code:    CASE_VIDEO_ERROR_CODES.rejected,
                fields:  rejected,
            },
        };
    }

    if (Object.keys(unavailable).length > 0) {
        return {
            ok:     false,
            status: 503,
            body:   {
                status:  "err",
                message: "YouTube could not be reached to check the videos. Try again.",
                code:    CASE_VIDEO_ERROR_CODES.unavailable,
                fields:  unavailable,
            },
        };
    }

    return { ok: true };
}

/**
 * Decides what a case create or update does with its videos, given the parsed
 * `videos` field and the ids the case holds now (none for a new case). Returns
 * `{ ok: true, videoIds }`, where `videoIds` is the list to write, or null when
 * the field was absent or the list is unchanged; or the error of
 * `checkNewCaseVideos`, before anything is written.
 */
export async function prepareCaseVideoSave(parsedVideos, currentIds, services) {
    if (!parsedVideos.provided) {
        return { ok: true, videoIds: null };
    }

    const plan = planCaseVideoChanges(currentIds, parsedVideos.ids);
    const check = await checkNewCaseVideos(plan.newIds, services);
    if (!check.ok) {
        return check;
    }

    return { ok: true, videoIds: plan.changed ? parsedVideos.ids : null };
}

function metadataOf(entry, videoAvailability) {
    if (entry?.status === "found") {
        const { title, description, channelTitle, durationSeconds } = entry.metadata || {};
        return {
            title:           title ?? null,
            description:     description ?? null,
            channelTitle:    channelTitle ?? null,
            durationSeconds: durationSeconds ?? null,
            availability:    videoAvailability(entry),
        };
    }

    if (entry?.status === "not_found") {
        return {
            title:           null,
            description:     null,
            channelTitle:    null,
            durationSeconds: null,
            availability:    "removed",
        };
    }

    return null;
}

/**
 * The videos of `GET /cases/:id`: each summary gains its canonical `url` and
 * its `metadata`, resolved through the metadata service's cache. `metadata` is
 * null when YouTube cannot be reached or video support is not configured.
 */
export async function resolveCaseVideos(summaries, { metadataService, videoAvailability }) {
    if (summaries.length === 0) {
        return [];
    }

    let entries = new Map();
    if (metadataService.isConfigured()) {
        try {
            entries = await metadataService.getVideoMetadata(
                summaries.map(video => video.youtubeVideoId)
            );
        } catch (error) {
            console.error("Unable to resolve case video metadata:", error);
        }
    }

    return summaries.map(video => ({
        youtubeVideoId: video.youtubeVideoId,
        position:       video.position,
        url:            canonicalYoutubeUrl(video.youtubeVideoId),
        metadata:       metadataOf(entries.get(video.youtubeVideoId), videoAvailability),
    }));
}

/** The video ids of a case, in order. `db` is a pg client or pool. */
export async function listCaseVideoIds(db, caseId) {
    const result = await db.query(
        "SELECT youtube_video_id FROM ethical_case_videos WHERE case_id = $1 ORDER BY position;",
        [caseId]
    );
    return result.rows.map(row => row.youtube_video_id);
}

/**
 * Replaces a case's videos with `videoIds`, in order. Run it inside the
 * caller's transaction so the list never shows half written.
 */
export async function replaceCaseVideos(db, caseId, videoIds) {
    await db.query("DELETE FROM ethical_case_videos WHERE case_id = $1;", [caseId]);

    if (videoIds.length === 0) {
        return;
    }

    await db.query(`
        INSERT INTO ethical_case_videos (case_id, position, youtube_video_id)
        SELECT $1, video.position, video.youtube_video_id
        FROM unnest($2::text[]) WITH ORDINALITY AS video (youtube_video_id, position);
    `, [caseId, videoIds]);
}

/** Copies the videos of one case to another, keeping their order. */
export async function copyCaseVideos(db, sourceCaseId, targetCaseId) {
    await db.query(`
        INSERT INTO ethical_case_videos (case_id, position, youtube_video_id)
        SELECT $2, ecv.position, ecv.youtube_video_id
        FROM ethical_case_videos ecv
        WHERE ecv.case_id = $1
        ORDER BY ecv.position
        ON CONFLICT (case_id, youtube_video_id) DO NOTHING;
    `, [sourceCaseId, targetCaseId]);
}
