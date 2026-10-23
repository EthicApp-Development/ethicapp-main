import { createElement, useMemo } from 'react';
import { parseRichText } from '../../utils/richText.js';
import { renderRichTextTree } from '../../utils/richTextElements.js';

// A teacher-written text, rendered by its content type (#766): text/markdown as
// the CommonMark subset, anything else as plain text that keeps its line breaks.
export default function RichText({ text, contentType, as = 'div', className = '' }) {
  const children = useMemo(
    () => renderRichTextTree(parseRichText(text, contentType), createElement),
    [text, contentType]
  );

  return createElement(as, { className: `rich-text ${className}`.trim() }, ...children);
}
