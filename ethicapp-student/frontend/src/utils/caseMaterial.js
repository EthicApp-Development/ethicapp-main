// The case's videos as complementary material below the case document (#788,
// epic #779). Kept free of React so the node tests can check it directly.
import { canonicalYoutubeUrl, isYoutubeVideoId } from './youtubeUrls.js';

const LONG_DESCRIPTION_LINES = 4;
const LONG_DESCRIPTION_CHARACTERS = 280;

function trimmedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Whether a description is long enough to collapse behind "Show more". */
export function isLongVideoDescription(description) {
  const text = trimmedText(description);
  return text.length > LONG_DESCRIPTION_CHARACTERS || text.split('\n').length > LONG_DESCRIPTION_LINES;
}

/**
 * The case's videos (`GET /cases/:id` → `videos`) in the case's order, as the
 * material section lists them; entries without a valid YouTube id are left out.
 * - `hasMetadata` is false when YouTube was unreachable or video support is not
 *   configured: the section then shows the watch link and a notice.
 * - `title` and `description` are plain text, empty when unknown.
 */
export function caseMaterialVideos(videos) {
  if (!Array.isArray(videos)) {
    return [];
  }

  return videos
    .filter((video) => isYoutubeVideoId(video?.youtubeVideoId))
    .map((video, index) => ({ video, index }))
    .sort((left, right) => (
      (Number(left.video.position) - Number(right.video.position)) || (left.index - right.index)
    ))
    .map(({ video }) => {
      const metadata = video.metadata && typeof video.metadata === 'object' ? video.metadata : null;
      const description = trimmedText(metadata?.description);
      return {
        videoId: video.youtubeVideoId,
        watchUrl: canonicalYoutubeUrl(video.youtubeVideoId),
        title: trimmedText(metadata?.title),
        description,
        hasLongDescription: isLongVideoDescription(description),
        hasMetadata: metadata !== null
      };
    });
}
