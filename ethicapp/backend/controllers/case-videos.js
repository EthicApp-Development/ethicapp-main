// Case video routes (#780, epic #779): whether video support is configured,
// and a throttled preview of a pasted YouTube URL for the case form.
//
// Mounted before the cases router, which would otherwise take
// /cases/videos/... as /cases/:id.

import express from "express";
import { requireRole } from "../helpers/auth-helper.js";
import { createSlidingWindowThrottle } from "../helpers/sliding-window-throttle.js";
import {
    canonicalYoutubeUrl,
    youtubeVideoId,
} from "../../common/modules/youtube-urls.js";
import youtubeVideoMetadata, {
    AVAILABILITY,
    ENTRY_STATUS,
    videoAvailability,
} from "../services/youtube-video-metadata.service.js";

const MAX_URL_LENGTH = 2048;

// Error responses of POST /cases/videos/preview. `code` is what clients map to
// translations; `message` is a fallback in English.
export const PREVIEW_ERRORS = Object.freeze({
    invalid_url: {
        status:  400,
        message: "The URL is not a YouTube video URL.",
    },
    not_found: {
        status:  404,
        message: "The video does not exist or was removed.",
    },
    private: {
        status:  422,
        message: "The video is private.",
    },
    not_embeddable: {
        status:  422,
        message: "The video's owner does not allow embedding it.",
    },
    not_configured: {
        status:  503,
        message: "Video support is not configured in this installation.",
    },
    unavailable: {
        status:  503,
        message: "YouTube could not be reached. Try again later.",
    },
    throttled: {
        status:  429,
        message: "Too many video lookups. Try again in a minute.",
    },
});

function previewError(res, code) {
    const { status, message } = PREVIEW_ERRORS[code];
    return res.status(status).json({ status: "err", code, message });
}

const ERROR_BY_STATUS = Object.freeze({
    [ENTRY_STATUS.NOT_FOUND]:      "not_found",
    [ENTRY_STATUS.UNAVAILABLE]:    "unavailable",
    [ENTRY_STATUS.NOT_CONFIGURED]: "not_configured",
});

const ERROR_BY_AVAILABILITY = Object.freeze({
    [AVAILABILITY.PRIVATE]:        "private",
    [AVAILABILITY.NOT_EMBEDDABLE]: "not_embeddable",
});

/** The video id in a pasted URL, or null when it is not a YouTube video URL. */
export function videoIdFromInput(url) {
    return typeof url === "string" && url.length <= MAX_URL_LENGTH ? youtubeVideoId(url) : null;
}

/**
 * The outcome of previewing a video: `{ status, body }` for a found,
 * embeddable video, or `{ code }` naming one of PREVIEW_ERRORS.
 */
export async function previewVideo(videoId, metadataService) {
    const entries = await metadataService.getVideoMetadata([videoId]);
    const entry = entries.get(videoId);
    if (entry?.status !== ENTRY_STATUS.FOUND) {
        return { code: ERROR_BY_STATUS[entry?.status] ?? "unavailable" };
    }

    const availability = videoAvailability(entry);
    if (ERROR_BY_AVAILABILITY[availability]) {
        return { code: ERROR_BY_AVAILABILITY[availability] };
    }
    return {
        status: 200,
        body:   {
            youtubeVideoId: videoId,
            url:            canonicalYoutubeUrl(videoId),
            metadata:       entry.metadata,
            availability,
        },
    };
}

/**
 * The case video router. `metadataService` is
 * { isConfigured(), getVideoMetadata(ids) }; `throttle` is
 * { tryAcquire(key) }, keyed by teacher.
 */
export function createCaseVideosRouter({
    metadataService = youtubeVideoMetadata,
    throttle = createSlidingWindowThrottle(),
} = {}) {
    const router = express.Router();

    router.get("/cases/videos/support", (req, res) => {
        if (!requireRole(req, res, "P")) {
            return;
        }
        return res.json({ enabled: metadataService.isConfigured() });
    });

    router.post("/cases/videos/preview", async (req, res) => {
        if (!requireRole(req, res, "P")) {
            return;
        }
        if (!metadataService.isConfigured()) {
            return previewError(res, "not_configured");
        }
        const videoId = videoIdFromInput(req.body?.url);
        if (!videoId) {
            return previewError(res, "invalid_url");
        }

        const { allowed, retryAfterMs } = throttle.tryAcquire(String(req.session.uid));
        if (!allowed) {
            res.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
            return previewError(res, "throttled");
        }

        try {
            const outcome = await previewVideo(videoId, metadataService);
            if (outcome.code) {
                return previewError(res, outcome.code);
            }
            return res.status(outcome.status).json(outcome.body);
        } catch (error) {
            console.error("[case-videos] Preview failed:", error?.message);
            return previewError(res, "unavailable");
        }
    });

    return router;
}

export default createCaseVideosRouter();
