// Rich text for the student views (#764). The views render the tree (#766).
// richTextCore.js and youtubeUrls.js are byte-identical copies of
// ethicapp/common/modules/rich-text.js and youtube-urls.js.
import MarkdownIt from 'markdown-it';
import { createRichText } from './richTextCore.js';
import { canonicalYoutubeUrl, youtubeVideoId } from './youtubeUrls.js';

export const { parseRichText, toPlainText } = createRichText(MarkdownIt, { youtubeVideoId, canonicalYoutubeUrl });
