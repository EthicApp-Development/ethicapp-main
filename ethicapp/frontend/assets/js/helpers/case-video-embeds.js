// Case videos embedded in question text (#787, epic #779): pure helpers for
// the design editor. They shape the case's videos (`GET /cases/:id`) into the
// choices of the "Insert a case video" dialog, describe an embedded video for
// its card in the editor, and find embedded videos the design's case does not
// hold.
//
// `caseVideos` is the case's `videos` array, or null or undefined while the
// case is unknown: then no video is reported as missing.
import { parseRichText } from "./rich-text.js";
import {
    caseVideosFromCase, caseVideoWarningKey, formatVideoDuration, isLongVideoDescription,
} from "./case-videos-form.js";

export const VIDEO_NOT_IN_CASE_KEY = "rich_text_editor_video_not_in_case";
export const VIDEO_METADATA_MISSING_KEY = "rich_text_editor_video_metadata_missing";

const PARSE_CACHE_LIMIT = 500;
const parsedVideos = new Map();

function isAvailable(video) {
    const availability = video?.metadata?.availability;
    return !availability || availability === "available";
}

/** The title a chosen video takes in the text: YouTube's title, or its id. */
export function caseVideoEmbedTitle(video) {
    const title = typeof video?.metadata?.title === "string" ? video.metadata.title.trim() : "";
    return title || video?.youtubeVideoId || "";
}

/**
 * The dialog's choices, in the case's order. A video without metadata
 * (YouTube unreachable) can be chosen and shows a notice; a video YouTube
 * reports as private, not embeddable or removed cannot be chosen.
 */
export function caseVideoChoices(caseVideos) {
    return caseVideosFromCase({ videos: caseVideos }).map(video => {
        const { metadata } = video;
        const selectable = !metadata || isAvailable(video);
        return {
            videoId:         video.youtubeVideoId,
            title:           caseVideoEmbedTitle(video),
            hasMetadata:     Boolean(metadata),
            duration:        formatVideoDuration(metadata?.durationSeconds),
            channelTitle:    metadata?.channelTitle || "",
            description:     metadata?.description || "",
            longDescription: isLongVideoDescription(metadata?.description),
            selectable,
            noticeKey:       metadata ? caseVideoWarningKey(video) : VIDEO_METADATA_MISSING_KEY,
        };
    });
}

/** The case's video with this id, or null. */
export function findCaseVideo(caseVideos, videoId) {
    if (!Array.isArray(caseVideos)) {
        return null;
    }
    return caseVideos.find(video => video?.youtubeVideoId === videoId) || null;
}

/**
 * What a video's card in the editor shows besides its title: the duration
 * when the case knows it, and a warning key when the case does not hold the
 * video or YouTube reports it unavailable.
 */
export function embeddedVideoStatus(caseVideos, videoId) {
    if (!Array.isArray(caseVideos)) {
        return { duration: "", warningKey: null };
    }
    const video = findCaseVideo(caseVideos, videoId);
    if (!video) {
        return { duration: "", warningKey: VIDEO_NOT_IN_CASE_KEY };
    }
    return {
        duration:   formatVideoDuration(video.metadata?.durationSeconds),
        warningKey: video.metadata && !isAvailable(video) ? caseVideoWarningKey(video) : null,
    };
}

/** The videos embedded in a text, in order: `[{ videoId, title }]`. */
export function embeddedVideos(text, contentType) {
    if (typeof text !== "string" || !text) {
        return [];
    }
    const key = `${contentType}\n${text}`;
    if (!parsedVideos.has(key)) {
        if (parsedVideos.size >= PARSE_CACHE_LIMIT) {
            parsedVideos.clear();
        }
        const videos = parseRichText(text, contentType)
            .filter(block => block.type === "video")
            .map(({ videoId, title }) => Object.freeze({ videoId, title }));
        parsedVideos.set(key, Object.freeze(videos));
    }
    return parsedVideos.get(key);
}

/** The embedded videos of a text that the case does not hold. */
export function videosMissingFromCase(text, contentType, caseVideos) {
    if (!Array.isArray(caseVideos)) {
        return [];
    }
    return embeddedVideos(text, contentType)
        .filter(video => !findCaseVideo(caseVideos, video.videoId));
}

/**
 * The design's warnings about embedded videos: one per video in a semantic
 * differential question that the case does not hold, as
 * `{ phaseNumber, questionNumber, videoId, title }`.
 */
export function designVideoWarnings(phases, caseVideos) {
    if (!Array.isArray(phases) || !Array.isArray(caseVideos)) {
        return [];
    }
    return phases.flatMap((phase, phaseIndex) => {
        const questions = Array.isArray(phase?.questions) ? phase.questions : [];
        return questions.flatMap((question, questionIndex) =>
            videosMissingFromCase(question?.q_text, question?.q_text_content_type, caseVideos)
                .map(video => ({
                    phaseNumber:    phaseIndex + 1,
                    questionNumber: questionIndex + 1,
                    videoId:        video.videoId,
                    title:          video.title,
                })));
    });
}
