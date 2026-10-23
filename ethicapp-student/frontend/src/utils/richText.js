// Rich text for the student views (#764). The views render the tree (#766).
// richTextCore.js is a byte-identical copy of ethicapp/common/modules/rich-text.js.
import MarkdownIt from 'markdown-it';
import { createRichText } from './richTextCore.js';

export const { parseRichText, toPlainText } = createRichText(MarkdownIt);
