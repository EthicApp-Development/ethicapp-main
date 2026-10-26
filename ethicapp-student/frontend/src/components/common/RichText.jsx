import { createElement, useMemo } from 'react';
import { useI18n } from '../../app/providers.jsx';
import { parseRichText } from '../../utils/richText.js';
import { renderRichTextTree } from '../../utils/richTextElements.js';
import VideoFacade from './VideoFacade.jsx';

// A teacher-written text, rendered by its content type (#766): text/markdown as
// the CommonMark subset, anything else as plain text that keeps its line breaks.
// Links open in a new tab and video blocks become the video facade (#786).
export default function RichText({ text, contentType, as = 'div', className = '' }) {
  const { t } = useI18n();
  const newTabHint = t('sessionDetail.linkOpensInNewTab');
  const children = useMemo(
    () => renderRichTextTree(parseRichText(text, contentType), createElement, { VideoFacade, newTabHint }),
    [text, contentType, newTabHint]
  );

  return createElement(as, { className: `rich-text ${className}`.trim() }, ...children);
}
