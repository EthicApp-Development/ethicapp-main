// Builds DOM nodes from a rich text tree (#765). Text only ever goes into text
// nodes, and attributes are set only to values EthicApp builds or validates,
// as canonical-schemas/rich-text/README.md requires:
// - links (#785) keep the tree's http or https href and open in a new tab;
// - videos (#785) show a click-to-load facade built from the video id only,
//   which requests nothing from YouTube or Google until it is activated.

import {
    canonicalYoutubeUrl, isYoutubeVideoId, youtubeEmbedUrl,
} from "../../../../common/modules/youtube-urls.js";

const BLOCK_ELEMENTS = { paragraph: "p" };
const INLINE_ELEMENTS = { strong: "strong", emphasis: "em" };

// The tree only holds http and https links with a host; anything else is
// refused here too, and shows its text only.
const HTTP_URL = /^https?:\/\/[^/?#]/iu;

/** The class of the button that replaces itself with the player when activated. */
export const VIDEO_FACADE_CLASS = "rich-text-video-facade";
/** The class of the element holding a video's title, inside its facade. */
export const VIDEO_TITLE_CLASS = "rich-text-video-title";

const PLAYER_ALLOW = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture;"
    + " fullscreen";

// English fallbacks; the views pass translated labels.
const DEFAULT_LABELS = {
    playVideo:        "Play video",
    videoUnavailable: "Video not available",
    opensInNewTab:    "(opens in a new tab)",
};

function element(document, tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.setAttribute("class", className);
    }
    if (text) {
        node.appendChild(document.createTextNode(text));
    }
    return node;
}

/** A duration in seconds as m:ss or h:mm:ss, or null when it is not known. */
export function formatVideoDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return null;
    }
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const rest = String(total % 60).padStart(2, "0");
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
        : `${minutes}:${rest}`;
}

function appendNodes(document, parent, nodes, context) {
    for (const node of nodes) {
        parent.appendChild(buildNode(document, node, context));
    }
    return parent;
}

function buildLinkElement(document, href) {
    const link = document.createElement("a");
    link.setAttribute("href", href);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    return link;
}

function appendNewTabNotice(document, link, context) {
    link.appendChild(document.createTextNode(" "));
    link.appendChild(element(document, "span", "sr-only", context.labels.opensInNewTab));
    return link;
}

function buildLink(document, node, context) {
    if (typeof node.href !== "string" || !HTTP_URL.test(node.href)) {
        return appendNodes(document, document.createDocumentFragment(), node.children, context);
    }
    const link = appendNodes(document, buildLinkElement(document, node.href), node.children,
        context);
    return appendNewTabNotice(document, link, context);
}

// The case's data for a video: its metadata, or null when the view has no
// case data, the case does not list the video, or YouTube was unreachable.
function videoMetadata(context, videoId) {
    const video = context.videos.find(item => item?.youtubeVideoId === videoId);
    return video?.metadata || null;
}

function buildVideoFacade(document, node, metadata, context) {
    const button = element(document, "button", VIDEO_FACADE_CLASS);
    button.setAttribute("type", "button");
    button.setAttribute("data-video-id", node.videoId);
    button.setAttribute("aria-label", `${context.labels.playVideo}: ${node.title}`);

    const placeholder = element(document, "span", "rich-text-video-placeholder");
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.appendChild(element(document, "span", "rich-text-video-play"));
    button.appendChild(placeholder);

    const caption = element(document, "span", "rich-text-video-caption");
    caption.appendChild(element(document, "span", VIDEO_TITLE_CLASS, node.title));
    const details = element(document, "span", "rich-text-video-details");
    const duration = formatVideoDuration(metadata?.durationSeconds);
    if (duration) {
        details.appendChild(element(document, "span", "rich-text-video-duration", duration));
    }
    details.appendChild(element(document, "span", "rich-text-video-source", "YouTube"));
    caption.appendChild(details);
    button.appendChild(caption);
    return button;
}

// A video the case reports as removed, private or not embeddable: a notice and
// the link to watch it on YouTube, instead of a play button.
function buildUnavailableVideo(document, node, context) {
    const card = element(document, "div", "rich-text-video-unavailable");
    card.appendChild(element(document, "span", VIDEO_TITLE_CLASS, node.title));
    card.appendChild(element(document, "span", "rich-text-video-notice",
        context.labels.videoUnavailable));
    const url = canonicalYoutubeUrl(node.videoId);
    const link = buildLinkElement(document, url);
    link.appendChild(document.createTextNode(url));
    card.appendChild(appendNewTabNotice(document, link, context));
    card.appendChild(element(document, "span", "rich-text-video-source", "YouTube"));
    return card;
}

function buildVideo(document, node, context) {
    if (node.provider !== "youtube" || !isYoutubeVideoId(node.videoId)) {
        return element(document, "p", null, node.title);
    }
    const metadata = videoMetadata(context, node.videoId);
    const availability = metadata?.availability;
    if (typeof availability === "string" && availability !== "available") {
        return buildUnavailableVideo(document, node, context);
    }
    const box = element(document, "div", "rich-text-video");
    box.appendChild(buildVideoFacade(document, node, metadata, context));
    return box;
}

// An item with a single paragraph, nested lists aside, shows that paragraph's
// text directly in the <li>, as CommonMark renders tight lists. Items with
// several paragraphs keep their <p> elements.
function buildListItem(document, item, context) {
    const listItem = document.createElement("li");
    const paragraphs = item.children.filter(child => child.type === "paragraph");
    for (const child of item.children) {
        if (paragraphs.length === 1 && child.type === "paragraph") {
            appendNodes(document, listItem, child.children, context);
        } else {
            listItem.appendChild(buildNode(document, child, context));
        }
    }
    return listItem;
}

function buildList(document, list, context) {
    const listElement = document.createElement(list.ordered ? "ol" : "ul");
    if (list.ordered && Number.isInteger(list.start) && list.start !== 1) {
        listElement.setAttribute("start", String(list.start));
    }
    for (const item of list.items) {
        listElement.appendChild(buildListItem(document, item, context));
    }
    return listElement;
}

function buildNode(document, node, context) {
    switch (node.type) {
    case "text":
        return document.createTextNode(node.value);
    case "break":
        return document.createElement("br");
    case "list":
        return buildList(document, node, context);
    case "link":
        return buildLink(document, node, context);
    case "video":
        return buildVideo(document, node, context);
    default: {
        const tag = BLOCK_ELEMENTS[node.type] || INLINE_ELEMENTS[node.type];
        if (!tag) {
            return document.createTextNode("");
        }
        return appendNodes(document, document.createElement(tag), node.children, context);
    }
    }
}

/**
 * A DocumentFragment with the tree's blocks, built with `document`.
 * - `videos`: the case's videos (`GET /cases/:id`), for durations and
 *   availability; without them, videos show no duration.
 * - `labels`: translated `playVideo`, `videoUnavailable` and `opensInNewTab`.
 */
export function buildRichTextFragment(document, tree, { videos, labels } = {}) {
    const context = {
        videos: Array.isArray(videos) ? videos : [],
        labels: { ...DEFAULT_LABELS, ...labels },
    };
    const blocks = Array.isArray(tree) ? tree : [];
    return appendNodes(document, document.createDocumentFragment(), blocks, context);
}

/**
 * The player that replaces a video's facade: a privacy-enhanced YouTube embed
 * built from the validated id only, playing as soon as it loads.
 */
export function buildVideoPlayer(document, videoId, title) {
    const player = element(document, "iframe", "rich-text-video-player");
    player.setAttribute("src", `${youtubeEmbedUrl(videoId)}&autoplay=1`);
    player.setAttribute("title", title || "YouTube");
    player.setAttribute("allow", PLAYER_ALLOW);
    player.setAttribute("allowfullscreen", "");
    player.setAttribute("loading", "lazy");
    player.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    return player;
}
