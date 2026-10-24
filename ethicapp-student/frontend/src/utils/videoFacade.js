// Pure helpers for rich text links and the video facade (#786, epic #779).
// Kept free of React so the node tests can check them directly.
import { canonicalYoutubeUrl, isYoutubeVideoId, youtubeEmbedUrl } from './youtubeUrls.js';

// What the parser already guarantees for a link's href (an http or https URL
// with a host), checked again so a renderer never emits anything else.
const SAFE_LINK_HREF = /^https?:\/\/[^/?#]/iu;

/** The fixed permissions of the activated player. */
export const VIDEO_PLAYER_ALLOW = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';

/** `href` when it is an http or https URL with a host, otherwise null. */
export function safeLinkHref(href) {
  return typeof href === 'string' && SAFE_LINK_HREF.test(href) ? href : null;
}

/** A duration as `m:ss` or `h:mm:ss`, or '' when unknown. */
export function formatVideoDuration(seconds) {
  if (!Number.isInteger(seconds) || seconds <= 0) {
    return '';
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/**
 * The case's videos (`GET /cases/:id` → `videos`) as a Map from video id to
 * its metadata, which may be null when YouTube could not be reached.
 */
export function indexCaseVideos(videos) {
  const byId = new Map();
  if (!Array.isArray(videos)) {
    return byId;
  }
  videos.forEach((video) => {
    if (isYoutubeVideoId(video?.youtubeVideoId)) {
      byId.set(video.youtubeVideoId, video.metadata && typeof video.metadata === 'object' ? video.metadata : null);
    }
  });
  return byId;
}

/**
 * What the facade shows for a video block, from its id, its title in the text
 * and the case's metadata for it (null when unknown).
 * - `playable` is false only when the case reports an availability other than
 *   `available`; unknown metadata keeps the video playable.
 * - `title` is the block's title, or the video's own title when the block's is
 *   just the URL (an autolink).
 * - `watchUrl` is the canonical link, built from the id.
 */
export function describeVideo({ videoId, title, metadata = null }) {
  const blockTitle = typeof title === 'string' ? title.trim() : '';
  const metadataTitle = typeof metadata?.title === 'string' ? metadata.title.trim() : '';
  const titleIsUrl = blockTitle === '' || /^https?:\/\//iu.test(blockTitle);
  return {
    title: titleIsUrl && metadataTitle ? metadataTitle : blockTitle,
    duration: formatVideoDuration(metadata?.durationSeconds),
    playable: !metadata?.availability || metadata.availability === 'available',
    watchUrl: canonicalYoutubeUrl(videoId)
  };
}

/** The activated player's URL: the privacy-enhanced embed, autoplaying after the tap. */
export function videoPlayerUrl(videoId) {
  return `${youtubeEmbedUrl(videoId)}&autoplay=1`;
}
