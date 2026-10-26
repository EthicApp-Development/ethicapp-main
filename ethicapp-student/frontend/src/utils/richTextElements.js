// Turns a rich text tree into React elements (#766, #786), as
// canonical-schemas/rich-text/README.md requires: text only as text children,
// an integer `start` on numbered lists, links with a fixed target and rel, and
// video blocks as the video facade built from the validated id only. `h` is
// React's createElement, injected so the mapping is testable without React.
import { isYoutubeVideoId } from './youtubeUrls.js';
import { safeLinkHref } from './videoFacade.js';

const INLINE_ELEMENTS = { strong: 'strong', emphasis: 'em' };

function renderNodes(nodes, context) {
  return nodes.flatMap((node) => (node.type === 'link' ? renderLink(node, context) : [renderNode(node, context)]));
}

// A link opens in a new tab, which a visually hidden hint announces without
// changing the visible text. A href the parser should never produce shows the
// link's text only. Returns an array of nodes.
function renderLink(link, context) {
  const { h, newTabHint } = context;
  const href = safeLinkHref(link.href);
  const children = renderNodes(link.children, context);
  if (!href) {
    return children;
  }
  const hint = newTabHint ? [h('span', { className: 'visually-hidden' }, ` (${newTabHint})`)] : [];
  return [h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, ...children, ...hint)];
}

// Without a facade component, or with an id the parser should never produce,
// a video shows its title in a paragraph, so no text is lost.
function renderVideo(video, context) {
  const { h, VideoFacade } = context;
  if (!VideoFacade || !isYoutubeVideoId(video.videoId)) {
    return h('p', null, video.title);
  }
  return h(VideoFacade, { videoId: video.videoId, title: video.title });
}

// An item with a single paragraph, nested lists aside, shows that paragraph's
// text directly in the <li>, as CommonMark renders tight lists.
function renderListItem(item, context) {
  const paragraphs = item.children.filter((child) => child.type === 'paragraph');
  const children = item.children.flatMap((child) => (paragraphs.length === 1 && child.type === 'paragraph'
    ? renderNodes(child.children, context)
    : [renderNode(child, context)]));
  return context.h('li', null, ...children);
}

function renderList(list, context) {
  const props = list.ordered && Number.isInteger(list.start) && list.start !== 1
    ? { start: list.start }
    : null;
  return context.h(list.ordered ? 'ol' : 'ul', props, ...list.items.map((item) => renderListItem(item, context)));
}

function renderNode(node, context) {
  const { h } = context;
  switch (node.type) {
    case 'text':
      return node.value;
    case 'break':
      return h('br', null);
    case 'paragraph':
      return h('p', null, ...renderNodes(node.children, context));
    case 'list':
      return renderList(node, context);
    case 'video':
      return renderVideo(node, context);
    default:
      return INLINE_ELEMENTS[node.type]
        ? h(INLINE_ELEMENTS[node.type], null, ...renderNodes(node.children, context))
        : '';
  }
}

/**
 * The tree's blocks as an array of React nodes.
 * - `VideoFacade` is the component a `video` block becomes, with the props
 *   `{ videoId, title }`.
 * - `newTabHint` is the localized "opens in a new tab" text announced after
 *   each link's text.
 */
export function renderRichTextTree(tree, h, { VideoFacade = null, newTabHint = '' } = {}) {
  return Array.isArray(tree) ? renderNodes(tree, { h, VideoFacade, newTabHint }) : [];
}
