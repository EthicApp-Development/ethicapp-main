// Turns a rich text tree into React elements (#766), as
// canonical-schemas/rich-text/README.md requires: text only as text children,
// and an integer `start` on numbered lists as the only attribute. `h` is
// React's createElement, injected so the mapping is testable without React.
//
// Until the student views get links and the video facade (#786), a link shows
// its text only and a video its title in a paragraph, so no text is lost.

const INLINE_ELEMENTS = { strong: 'strong', emphasis: 'em' };

function renderNodes(nodes, h) {
  return nodes.flatMap((node) => (node.type === 'link' ? renderNodes(node.children, h) : [renderNode(node, h)]));
}

// An item with a single paragraph, nested lists aside, shows that paragraph's
// text directly in the <li>, as CommonMark renders tight lists.
function renderListItem(item, h) {
  const paragraphs = item.children.filter((child) => child.type === 'paragraph');
  const children = item.children.flatMap((child) => (paragraphs.length === 1 && child.type === 'paragraph'
    ? renderNodes(child.children, h)
    : [renderNode(child, h)]));
  return h('li', null, ...children);
}

function renderList(list, h) {
  const props = list.ordered && Number.isInteger(list.start) && list.start !== 1
    ? { start: list.start }
    : null;
  return h(list.ordered ? 'ol' : 'ul', props, ...list.items.map((item) => renderListItem(item, h)));
}

function renderNode(node, h) {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'break':
      return h('br', null);
    case 'paragraph':
      return h('p', null, ...renderNodes(node.children, h));
    case 'list':
      return renderList(node, h);
    case 'video':
      return h('p', null, node.title);
    default:
      return INLINE_ELEMENTS[node.type]
        ? h(INLINE_ELEMENTS[node.type], null, ...renderNodes(node.children, h))
        : '';
  }
}

/** The tree's blocks as an array of React nodes. */
export function renderRichTextTree(tree, h) {
  return Array.isArray(tree) ? renderNodes(tree, h) : [];
}
