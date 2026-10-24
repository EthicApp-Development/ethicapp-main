// YouTube Data API v3 client (#780, epic #779): one `videos.list` call for up
// to 50 video ids, mapped to the few fields EthicApp shows. The API key comes
// from GOOGLE_API_KEY and is never logged or put in an error message.

const VIDEOS_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
const VIDEO_PARTS = "snippet,contentDetails,status";
const DEFAULT_TIMEOUT_MS = 8000;
const MINIMUM_TIMEOUT_MS = 1000;
const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded"]);

export const MAX_IDS_PER_REQUEST = 50;

export const YOUTUBE_ERROR_CODES = Object.freeze({
    NOT_CONFIGURED: "YOUTUBE_NOT_CONFIGURED",
    UNAVAILABLE:    "YOUTUBE_UNAVAILABLE",
    QUOTA_EXCEEDED: "YOUTUBE_QUOTA_EXCEEDED",
});

/** A failed lookup. `code` is one of YOUTUBE_ERROR_CODES. */
export class YoutubeDataApiError extends Error {
    constructor(code, message, { statusCode = null, reason = null } = {}) {
        super(message);
        this.name = "YoutubeDataApiError";
        this.code = code;
        this.statusCode = statusCode;
        this.reason = reason;
    }
}

const ISO_DURATION = new RegExp(
    "^P(?:(\\d+)W)?(?:(\\d+)D)?"
    + "(?:T(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+(?:\\.\\d+)?)S)?)?$",
    "u"
);

/**
 * Seconds in an ISO 8601 duration as YouTube writes them (PT15M33S, PT1H2S,
 * P1DT2H, P0D), or null when the value is not such a duration.
 */
export function parseIsoDurationSeconds(value) {
    if (typeof value !== "string") {
        return null;
    }
    const match = ISO_DURATION.exec(value.trim());
    if (!match || value.trim() === "P" || value.trim().endsWith("T")) {
        return null;
    }
    const [, weeks, days, hours, minutes, seconds] = match.map((part) => Number(part ?? 0));
    const total = (((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 + seconds;
    return Math.round(total);
}

function readTimeoutMs(value) {
    const configured = Number(value);
    return Number.isInteger(configured) && configured >= MINIMUM_TIMEOUT_MS
        ? configured
        : DEFAULT_TIMEOUT_MS;
}

function textOrEmpty(value) {
    return typeof value === "string" ? value : "";
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function errorReason(body) {
    const errors = body?.error?.errors;
    const reason = Array.isArray(errors) ? errors.find((item) => item?.reason)?.reason : null;
    return typeof reason === "string" ? reason : null;
}

/** The EthicApp shape of one `videos.list` item, or null when it has no id. */
export function mapVideoItem(item) {
    if (!item || typeof item.id !== "string") {
        return null;
    }
    const snippet = item.snippet ?? {};
    const status = item.status ?? {};
    return {
        id:              item.id,
        title:           textOrEmpty(snippet.title),
        description:     textOrEmpty(snippet.description),
        channelTitle:    textOrEmpty(snippet.channelTitle),
        durationSeconds: parseIsoDurationSeconds(item.contentDetails?.duration),
        embeddable:      status.embeddable !== false,
        privacyStatus:   typeof status.privacyStatus === "string" ? status.privacyStatus : null,
    };
}

export class YoutubeDataClient {
    constructor({
        env = process.env,
        fetchImpl = globalThis.fetch,
        setTimeoutImpl = setTimeout,
        clearTimeoutImpl = clearTimeout,
    } = {}) {
        if (typeof fetchImpl !== "function") {
            throw new Error("YoutubeDataClient requires a fetch implementation.");
        }
        this.env = env;
        this.fetchImpl = fetchImpl;
        this.setTimeoutImpl = setTimeoutImpl;
        this.clearTimeoutImpl = clearTimeoutImpl;
    }

    getApiKey() {
        const key = this.env.GOOGLE_API_KEY;
        return typeof key === "string" ? key.trim() : "";
    }

    isConfigured() {
        return this.getApiKey().length > 0;
    }

    getTimeoutMs() {
        return readTimeoutMs(this.env.YOUTUBE_DATA_API_TIMEOUT_MS);
    }

    /**
     * Looks up at most 50 ids in one request. Resolves to
     * `{ videos: Map<id, video>, notFoundIds: string[] }`, where a video is
     * `{ id, title, description, channelTitle, durationSeconds, embeddable,
     * privacyStatus }`. Rejects with a YoutubeDataApiError.
     */
    async getVideos(ids) {
        const uniqueIds = [...new Set(ids)];
        if (uniqueIds.length > MAX_IDS_PER_REQUEST) {
            throw new RangeError(`At most ${MAX_IDS_PER_REQUEST} ids per request.`);
        }
        if (uniqueIds.length === 0) {
            return { videos: new Map(), notFoundIds: [] };
        }
        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw new YoutubeDataApiError(
                YOUTUBE_ERROR_CODES.NOT_CONFIGURED,
                "GOOGLE_API_KEY is not set."
            );
        }

        const query = new URLSearchParams({
            part: VIDEO_PARTS,
            id:   uniqueIds.join(","),
            key:  apiKey,
        });
        const body = await this.requestJson(`${VIDEOS_ENDPOINT}?${query}`);
        if (!body || !Array.isArray(body.items)) {
            throw new YoutubeDataApiError(
                YOUTUBE_ERROR_CODES.UNAVAILABLE,
                "YouTube Data API returned an unexpected response."
            );
        }

        const requested = new Set(uniqueIds);
        const videos = new Map();
        for (const item of body.items) {
            const video = mapVideoItem(item);
            if (video && requested.has(video.id)) {
                videos.set(video.id, video);
            }
        }
        const notFoundIds = uniqueIds.filter((id) => !videos.has(id));
        return { videos, notFoundIds };
    }

    // `url` carries the key: it is used for the request only, never in errors.
    async requestJson(url) {
        const controller = new AbortController();
        const timeoutId = this.setTimeoutImpl(() => controller.abort(), this.getTimeoutMs());
        let response;
        let text;
        try {
            response = await this.fetchImpl(url, {
                method:  "GET",
                headers: { Accept: "application/json" },
                signal:  controller.signal,
            });
            text = await response.text();
        } catch (error) {
            const timedOut = controller.signal.aborted || error?.name === "AbortError";
            throw new YoutubeDataApiError(
                YOUTUBE_ERROR_CODES.UNAVAILABLE,
                timedOut
                    ? "YouTube Data API request timed out."
                    : "YouTube Data API could not be reached.",
                { reason: timedOut ? "timeout" : "network" }
            );
        } finally {
            this.clearTimeoutImpl(timeoutId);
        }

        const body = text ? safeJsonParse(text) : null;
        if (!response.ok) {
            const reason = errorReason(body);
            const code = response.status === 403 && QUOTA_REASONS.has(reason)
                ? YOUTUBE_ERROR_CODES.QUOTA_EXCEEDED
                : YOUTUBE_ERROR_CODES.UNAVAILABLE;
            throw new YoutubeDataApiError(
                code,
                `YouTube Data API answered HTTP ${response.status}${reason ? ` (${reason})` : ""}.`,
                { statusCode: response.status, reason }
            );
        }
        return body;
    }
}

const youtubeDataClient = new YoutubeDataClient();

export default youtubeDataClient;
