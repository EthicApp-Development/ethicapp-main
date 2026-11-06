// The Markdown subset of student-result/v1 (ethicapp-ai-additions README,
// "Text Formats"): paragraphs, line breaks, bold, italics, bulleted and
// numbered lists and backslash escapes. Everything else (headings, links,
// autolinks, images, code, blockquotes, tables, rules, HTML tags and entities)
// stays literal text. The text becomes the same tree as teacher-written rich
// text (utils/richTextCore.js), so utils/richTextElements.js renders it, and no
// HTML string is ever produced.
import MarkdownIt from 'markdown-it';
import { parseRichText } from '../../../../utils/richText.js';

// The contract's setup: the 'zero' preset keeps only paragraphs and text, and
// leaves html, linkify and typographer off. breaks: a single line feed inside
// a paragraph ends the line.
const markdown = new MarkdownIt('zero', {
  breaks: true, html: false, linkify: false, typographer: false
}).enable(['list', 'emphasis', 'newline', 'escape']);

const INLINE_CONTAINERS = { strong_open: 'strong', em_open: 'emphasis' };
const INLINE_CLOSERS = new Set(['strong_close', 'em_close']);

// Appends an inline node, merging adjacent text and dropping empty text.
function pushInline(nodes, node) {
  if (node.type === 'text') {
    if (!node.value) {
      return;
    }
    const last = nodes[nodes.length - 1];
    if (last?.type === 'text') {
      last.value += node.value;
      return;
    }
  }
  nodes.push(node);
}

function inlineTree(tokens) {
  const root = [];
  const stack = [root];
  for (const token of tokens) {
    const siblings = stack[stack.length - 1];
    if (token.type === 'text') {
      pushInline(siblings, { type: 'text', value: token.content });
    } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
      siblings.push({ type: 'break' });
    } else if (INLINE_CONTAINERS[token.type]) {
      const node = { type: INLINE_CONTAINERS[token.type], children: [] };
      siblings.push(node);
      stack.push(node.children);
    } else if (INLINE_CLOSERS.has(token.type) && stack.length > 1) {
      stack.pop();
    } else {
      throw new Error('Unexpected inline token');
    }
  }
  return root;
}

function listNode(token) {
  const ordered = token.type === 'ordered_list_open';
  return {
    type: 'list',
    ordered,
    start: ordered ? Number(token.attrGet('start') ?? 1) : null,
    items: []
  };
}

const CLOSERS = new Set([
  'paragraph_close', 'bullet_list_close', 'ordered_list_close', 'list_item_close'
]);

// Opens a block in `container`, returning where its children go.
function openBlock(token, container) {
  if (token.type === 'paragraph_open') {
    const paragraph = { type: 'paragraph', children: [] };
    container.push(paragraph);
    return paragraph.children;
  }
  if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
    const list = listNode(token);
    container.push(list);
    return list.items;
  }
  if (token.type === 'list_item_open') {
    const item = { type: 'listItem', children: [] };
    container.push(item);
    return item.children;
  }
  throw new Error('Unexpected block token');
}

function markdownTree(text) {
  const root = [];
  const stack = [root];
  for (const token of markdown.parse(text, {})) {
    const container = stack[stack.length - 1];
    if (token.type === 'inline') {
      inlineTree(token.children).forEach((node) => pushInline(container, node));
    } else if (CLOSERS.has(token.type)) {
      stack.pop();
    } else {
      stack.push(openBlock(token, container));
    }
  }
  return root;
}

/**
 * The tree of a Markdown-subset text, in the node types of
 * canonical-schemas/rich-text/README.md: paragraph, list, listItem, strong,
 * emphasis, break and text. Should the parser ever produce a token outside
 * the subset, the text is shown as plain text, which keeps its line breaks.
 * @param {unknown} text
 * @returns {object[]}
 */
export function parseStudentResultMarkdown(text) {
  const source = typeof text === 'string' ? text : '';
  try {
    return markdownTree(source);
  } catch {
    return parseRichText(source, 'text/plain');
  }
}
