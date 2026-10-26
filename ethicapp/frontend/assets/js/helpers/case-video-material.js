// The case's videos as complementary material below the case document (#788,
// epic #779): pure helpers for the teacher's case page and activity case tab.
import {
    canonicalYoutubeUrl, isYoutubeVideoId,
} from "../../../../common/modules/youtube-urls.js";
import { caseVideosFromCase, isLongVideoDescription } from "./case-videos-form.js";

/**
 * How a listed video is shown:
 * - `facade`: the facade, or the unavailable notice when YouTube reports the
 *   video removed, private or not embeddable;
 * - `link`: its watch link and a notice, when its metadata is missing because
 *   YouTube was unreachable or video support is not configured.
 */
export const CASE_MATERIAL_DISPLAY = Object.freeze({ facade: "facade", link: "link" });

function trimmedText(value) {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * The case's videos (`GET /cases/:id`), in the case's order, as the material
 * section lists them. Videos without a valid YouTube id are left out.
 * Each item is `{ youtubeVideoId, watchUrl, title, description,
 * hasLongDescription, metadata, display }`; `title` and `description` are
 * empty strings when unknown.
 */
export function caseMaterialVideos(caseObj) {
    return caseVideosFromCase(caseObj)
        .filter(video => isYoutubeVideoId(video.youtubeVideoId))
        .map(video => {
            const description = trimmedText(video.metadata?.description);
            return {
                youtubeVideoId:     video.youtubeVideoId,
                watchUrl:           canonicalYoutubeUrl(video.youtubeVideoId),
                title:              trimmedText(video.metadata?.title),
                description,
                hasLongDescription: isLongVideoDescription(description),
                metadata:           video.metadata,
                display:            video.metadata
                    ? CASE_MATERIAL_DISPLAY.facade
                    : CASE_MATERIAL_DISPLAY.link,
            };
        });
}
