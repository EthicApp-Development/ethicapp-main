// The case form's video list (#783, epic #779): pure helpers for the teacher
// case form. They shape the videos of `GET /cases/:id` and of the preview
// endpoint into list items, edit the ordered list, build the `videos` field
// the case API takes, and map API error codes to translation keys.
import { youtubeVideoId } from "../../../../common/modules/youtube-urls.js";

/** At most this many videos per case, as the case API enforces. */
export const MAX_CASE_VIDEOS = 50;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const LONG_DESCRIPTION_LINES = 4;
const LONG_DESCRIPTION_CHARACTERS = 280;

const PREVIEW_ERROR_KEYS = Object.freeze({
    invalid_url:    "case_videos_error_invalid_url",
    not_found:      "case_videos_error_not_found",
    private:        "case_videos_error_private",
    not_embeddable: "case_videos_error_not_embeddable",
    not_configured: "case_videos_error_not_configured",
    unavailable:    "case_videos_error_unavailable",
    throttled:      "case_videos_error_throttled",
});

const SAVE_ERROR_KEYS = Object.freeze({
    CASE_VIDEOS_INVALID:        "case_videos_save_invalid",
    CASE_VIDEOS_REJECTED:       "case_videos_save_rejected",
    CASE_VIDEOS_NOT_CONFIGURED: "case_videos_save_not_configured",
    CASE_VIDEOS_UNAVAILABLE:    "case_videos_save_unavailable",
});

// Per-video reasons in `fields` of a CASE_VIDEOS_* save error.
const FIELD_ERROR_KEYS = Object.freeze({
    invalid_id:     "case_videos_error_invalid_url",
    not_found:      "case_videos_error_not_found",
    private:        "case_videos_error_private",
    not_embeddable: "case_videos_error_not_embeddable",
    not_configured: "case_videos_error_not_configured",
    unavailable:    "case_videos_error_unavailable",
});

const AVAILABILITY_WARNING_KEYS = Object.freeze({
    private:        "case_videos_availability_private",
    not_embeddable: "case_videos_availability_not_embeddable",
    removed:        "case_videos_availability_removed",
});

function twoDigits(value) {
    return String(value).padStart(2, "0");
}

/**
 * A duration in seconds as `m:ss`, or `h:mm:ss` from one hour on. Returns an
 * empty string when the duration is unknown.
 */
export function formatVideoDuration(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined || totalSeconds === "") {
        return "";
    }
    const seconds = Math.floor(Number(totalSeconds));
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "";
    }

    const hours = Math.floor(seconds / SECONDS_PER_HOUR);
    const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    const rest = seconds % SECONDS_PER_MINUTE;
    if (hours > 0) {
        return `${hours}:${twoDigits(minutes)}:${twoDigits(rest)}`;
    }
    return `${minutes}:${twoDigits(rest)}`;
}

/** Whether a description is long enough to collapse behind "Show more". */
export function isLongVideoDescription(description) {
    const text = String(description || "");
    return text.length > LONG_DESCRIPTION_CHARACTERS
        || text.split("\n").length > LONG_DESCRIPTION_LINES;
}

function normalizeMetadata(metadata, availability) {
    if (!metadata || typeof metadata !== "object") {
        return null;
    }

    return {
        title:           metadata.title ?? null,
        description:     metadata.description ?? null,
        channelTitle:    metadata.channelTitle ?? null,
        durationSeconds: metadata.durationSeconds ?? null,
        availability:    availability ?? metadata.availability ?? null,
    };
}

/**
 * The list item of a `POST /cases/videos/preview` response:
 * `{ youtubeVideoId, url, metadata }`.
 */
export function caseVideoFromPreview(preview) {
    return {
        youtubeVideoId: preview.youtubeVideoId,
        url:            preview.url,
        metadata:       normalizeMetadata(preview.metadata, preview.availability),
    };
}

/** The ordered list items of the `videos` of `GET /cases/:id`. */
export function caseVideosFromCase(caseObj) {
    if (!Array.isArray(caseObj?.videos)) {
        return [];
    }

    return caseObj.videos
        .filter(video => typeof video?.youtubeVideoId === "string")
        .slice()
        .sort((left, right) => Number(left.position) - Number(right.position))
        .map(video => ({
            youtubeVideoId: video.youtubeVideoId,
            url:            video.url || "",
            metadata:       normalizeMetadata(video.metadata),
        }));
}

/** The YouTube ids of the list, in order. */
export function caseVideoIds(videos) {
    return Array.isArray(videos) ? videos.map(video => video.youtubeVideoId) : [];
}

/**
 * Checks a pasted URL before asking for its preview. Returns
 * `{ ok: true, videoId }`, or `{ ok: false, errorKey }` when the URL is not a
 * YouTube video URL, the video is already in the list, or the list is full.
 */
export function checkCaseVideoUrl(videos, url) {
    const videoId = youtubeVideoId(String(url || "").trim());
    if (!videoId) {
        return { ok: false, errorKey: PREVIEW_ERROR_KEYS.invalid_url };
    }
    return checkCaseVideoId(videos, videoId);
}

/** Whether `videoId` can join the list: not a duplicate and within the limit. */
export function checkCaseVideoId(videos, videoId) {
    const ids = caseVideoIds(videos);
    if (ids.includes(videoId)) {
        return { ok: false, errorKey: "case_videos_error_duplicate" };
    }
    if (ids.length >= MAX_CASE_VIDEOS) {
        return { ok: false, errorKey: "case_videos_error_too_many" };
    }
    return { ok: true, videoId };
}

/** The list with `video` appended, unless it is a duplicate or the list is full. */
export function addCaseVideo(videos, video) {
    const list = Array.isArray(videos) ? videos : [];
    if (!checkCaseVideoId(list, video.youtubeVideoId).ok) {
        return list;
    }
    return [...list, video];
}

/** The list with the video at `index` moved by `offset` places, when possible. */
export function moveCaseVideo(videos, index, offset) {
    const target = index + offset;
    if (!Array.isArray(videos) || index < 0 || index >= videos.length
        || target < 0 || target >= videos.length) {
        return videos;
    }

    const list = videos.slice();
    const [video] = list.splice(index, 1);
    list.splice(target, 0, video);
    return list;
}

/** The list without the video at `index`. */
export function removeCaseVideo(videos, index) {
    if (!Array.isArray(videos) || index < 0 || index >= videos.length) {
        return videos;
    }
    return videos.filter((_video, position) => position !== index);
}

/**
 * The `videos` field of a case create or update: the ordered ids, or null when
 * the list equals `initialIds`, so the field is left out and the case API
 * keeps the videos unchanged.
 */
export function caseVideosPayload(videos, initialIds = []) {
    const ids = caseVideoIds(videos);
    const initial = Array.isArray(initialIds) ? initialIds : [];
    const unchanged = ids.length === initial.length
        && ids.every((id, index) => id === initial[index]);
    return unchanged ? null : ids;
}

/** The translation key of a failed preview request. */
export function previewErrorMessageKey(error) {
    const code = error?.data?.code;
    if (PREVIEW_ERROR_KEYS[code]) {
        return PREVIEW_ERROR_KEYS[code];
    }
    if (error?.status === 429) {
        return PREVIEW_ERROR_KEYS.throttled;
    }
    return "case_videos_error_preview_failed";
}

/** The translation key of a CASE_VIDEOS_* save error, or null for others. */
export function caseVideoSaveErrorKey(error) {
    return SAVE_ERROR_KEYS[error?.data?.code] ?? null;
}

/**
 * The per-video translation keys of a CASE_VIDEOS_* save error, keyed by
 * YouTube id. Other errors, and fields about the whole list, give none.
 */
export function caseVideoFieldErrorKeys(error) {
    const fields = caseVideoSaveErrorKey(error) ? error.data.fields : null;
    if (!fields || typeof fields !== "object") {
        return {};
    }

    return Object.fromEntries(Object.entries(fields)
        .filter(([id, reason]) => id !== "videos" && FIELD_ERROR_KEYS[reason])
        .map(([id, reason]) => [id, FIELD_ERROR_KEYS[reason]]));
}

/**
 * The warning shown for a listed video, or null when it is available: its
 * metadata is missing, or YouTube reports it private, not embeddable or
 * removed.
 */
export function caseVideoWarningKey(video) {
    if (!video?.metadata) {
        return "case_videos_metadata_missing";
    }
    const availability = video.metadata.availability;
    if (!availability || availability === "available") {
        return null;
    }
    return AVAILABILITY_WARNING_KEYS[availability] ?? "case_videos_availability_unknown";
}
