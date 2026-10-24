// YouTube video URLs (#780, epic #779): recognizing the forms teachers paste,
// and building the only URLs EthicApp itself uses. Every URL EthicApp shows or
// embeds is rebuilt from a validated 11-character id, never taken as typed.
//
// This module imports nothing. ethicapp-student builds separately and keeps a
// byte-identical copy (src/utils/youtubeUrls.js), which its tests compare with
// this one.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;

const WATCH_HOSTS = new Set([
    "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
]);
const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const NOCOOKIE_HOSTS = new Set(["youtube-nocookie.com", "www.youtube-nocookie.com"]);
// Paths whose second segment is the video id: /embed/<id>, /shorts/<id>, ...
const ID_PATH_PREFIXES = new Set(["embed", "shorts", "live", "v"]);

/** Whether `value` is a well-formed YouTube video id. */
export function isYoutubeVideoId(value) {
    return typeof value === "string" && VIDEO_ID.test(value);
}

function parseUrl(value) {
    if (typeof value !== "string") {
        return null;
    }
    try {
        const url = new URL(value.trim());
        return url.protocol === "https:" || url.protocol === "http:" ? url : null;
    } catch {
        return null;
    }
}

function idFromPath(url) {
    const [prefix, id] = url.pathname.split("/").filter(Boolean);
    return ID_PATH_PREFIXES.has(prefix) ? id : null;
}

/**
 * The video id of a YouTube video URL, or null. Accepted forms:
 * - youtube.com/watch?v=<id>, also on m., www. and music. hosts;
 * - youtube.com/embed|shorts|live|v/<id>;
 * - youtu.be/<id>;
 * - youtube-nocookie.com/embed/<id>.
 * Only http and https are accepted; playlists without a video are not.
 */
export function youtubeVideoId(value) {
    const url = parseUrl(value);
    if (!url) {
        return null;
    }
    const host = url.hostname.toLowerCase();
    let id = null;
    if (WATCH_HOSTS.has(host)) {
        id = url.pathname === "/watch" ? url.searchParams.get("v") : idFromPath(url);
    } else if (SHORT_HOSTS.has(host)) {
        id = url.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (NOCOOKIE_HOSTS.has(host)) {
        id = idFromPath(url);
    }
    return isYoutubeVideoId(id) ? id : null;
}

/** The canonical watch URL for a video id: what EthicApp stores in links. */
export function canonicalYoutubeUrl(videoId) {
    if (!isYoutubeVideoId(videoId)) {
        throw new TypeError("Invalid YouTube video id.");
    }
    return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * The privacy-enhanced embed URL for a video id: no cookies before playback,
 * inline playback on phones, related videos from the same channel only.
 */
export function youtubeEmbedUrl(videoId) {
    if (!isYoutubeVideoId(videoId)) {
        throw new TypeError("Invalid YouTube video id.");
    }
    return `https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1&rel=0`;
}
