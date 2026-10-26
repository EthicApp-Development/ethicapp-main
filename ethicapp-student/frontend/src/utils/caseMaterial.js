// The case's complementary material below the case document: its videos
// (#788, epic #779), then its Google Drive documents (#794, epic #789). Kept
// free of React so the node tests can check it directly.
import {
  canonicalGoogleDocumentUrl,
  googleDocumentKey,
  parseGoogleDocumentUrl
} from './googleDocumentUrls.js';
import { canonicalYoutubeUrl, isYoutubeVideoId } from './youtubeUrls.js';

const LONG_DESCRIPTION_LINES = 4;
const LONG_DESCRIPTION_CHARACTERS = 280;

function trimmedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Whether a description is long enough to collapse behind "Show more". */
export function isLongVideoDescription(description) {
  const text = trimmedText(description);
  return text.length > LONG_DESCRIPTION_CHARACTERS || text.split('\n').length > LONG_DESCRIPTION_LINES;
}

/**
 * The case's videos (`GET /cases/:id` → `videos`) in the case's order, as the
 * material section lists them; entries without a valid YouTube id are left out.
 * - `hasMetadata` is false when YouTube was unreachable or video support is not
 *   configured: the section then shows the watch link and a notice.
 * - `title` and `description` are plain text, empty when unknown.
 */
export function caseMaterialVideos(videos) {
  if (!Array.isArray(videos)) {
    return [];
  }

  return videos
    .filter((video) => isYoutubeVideoId(video?.youtubeVideoId))
    .map((video, index) => ({ video, index }))
    .sort((left, right) => (
      (Number(left.video.position) - Number(right.video.position)) || (left.index - right.index)
    ))
    .map(({ video }) => {
      const metadata = video.metadata && typeof video.metadata === 'object' ? video.metadata : null;
      const description = trimmedText(metadata?.description);
      return {
        videoId: video.youtubeVideoId,
        watchUrl: canonicalYoutubeUrl(video.youtubeVideoId),
        title: trimmedText(metadata?.title),
        description,
        hasLongDescription: isLongVideoDescription(description),
        hasMetadata: metadata !== null
      };
    });
}

/**
 * How a listed document is shown (#794):
 * - `link`: Google reports it available; its link, labeled with its name;
 * - `unavailable`: Google reports it not public or not found; a notice, and no
 *   link;
 * - `unverified`: its availability is unknown (Google unreachable, or document
 *   support not configured); its link, labeled with its URL, and a notice.
 */
export const CASE_DOCUMENT_DISPLAY = Object.freeze({
  link: 'link',
  unavailable: 'unavailable',
  unverified: 'unverified'
});

const UNAVAILABLE_DOCUMENT_STATUSES = new Set(['not_public', 'not_found']);

const PRODUCT_DOCUMENT_TYPES = Object.freeze({
  document: 'document',
  spreadsheets: 'spreadsheet',
  presentation: 'presentation'
});

/** The Font Awesome 6 solid icon of each document type. */
export const CASE_DOCUMENT_TYPE_ICONS = Object.freeze({
  document: 'fa-file-word',
  spreadsheet: 'fa-file-excel',
  presentation: 'fa-file-powerpoint',
  pdf: 'fa-file-pdf',
  file: 'fa-file'
});

/**
 * The type of a document, which picks its icon and its visually hidden name:
 * Google Docs, Sheets and Slides by product, and other Drive files as `pdf`
 * when their MIME type says so, or `file` otherwise.
 */
export function caseDocumentType(product, mimeType) {
  if (Object.hasOwn(PRODUCT_DOCUMENT_TYPES, product)) {
    return PRODUCT_DOCUMENT_TYPES[product];
  }
  return mimeType === 'application/pdf' ? 'pdf' : 'file';
}

// The parts of an opening URL from the API, when it is the canonical URL of a
// Google document; null for anything else. The URL is used as the API sent it,
// and this only keeps a malformed or foreign value out of an href.
function canonicalDocumentParts(url) {
  const parsed = parseGoogleDocumentUrl(url);
  if (!parsed) {
    return null;
  }
  try {
    return canonicalGoogleDocumentUrl(parsed) === url ? parsed : null;
  } catch {
    return null;
  }
}

function documentDisplay(availability) {
  if (availability?.status === 'available') {
    return CASE_DOCUMENT_DISPLAY.link;
  }
  if (UNAVAILABLE_DOCUMENT_STATUSES.has(availability?.status)) {
    return CASE_DOCUMENT_DISPLAY.unavailable;
  }
  return CASE_DOCUMENT_DISPLAY.unverified;
}

/**
 * The case's documents (`GET /cases/:id` → `documents`, #794) in the case's
 * order, listed after its videos. Entries whose `url` is not a canonical Google
 * document URL are left out, and so are repeats.
 *
 * Each item is `{ key, url, name, linkText, type, icon, display, status }`:
 * - `url` is the API's opening URL, as sent;
 * - `name` is the document's name as Google reports it, plain text, or an
 *   empty string when unknown; `linkText` is the name, or the URL without one;
 * - `type` and `icon` come from `caseDocumentType` and
 *   `CASE_DOCUMENT_TYPE_ICONS`;
 * - `display` is one of `CASE_DOCUMENT_DISPLAY`;
 * - `status` is the reported availability status, or null when unknown.
 */
export function caseMaterialDocuments(documents) {
  if (!Array.isArray(documents)) {
    return [];
  }

  const seenKeys = new Set();
  return documents
    .map((document, index) => ({ document, index }))
    .filter(({ document }) => document && typeof document === 'object')
    .sort((left, right) => (
      (Number(left.document.position) - Number(right.document.position)) || (left.index - right.index)
    ))
    .map(({ document }) => {
      const parsed = canonicalDocumentParts(document.url);
      if (!parsed) {
        return null;
      }
      const availability = document.availability && typeof document.availability === 'object'
        ? document.availability
        : null;
      const display = documentDisplay(availability);
      const type = caseDocumentType(parsed.product, availability?.mimeType);
      const name = trimmedText(availability?.name);
      return {
        key: googleDocumentKey(parsed),
        url: document.url,
        name,
        linkText: name || document.url,
        type,
        icon: CASE_DOCUMENT_TYPE_ICONS[type],
        display,
        status: display === CASE_DOCUMENT_DISPLAY.unverified ? null : availability.status
      };
    })
    .filter((document) => {
      if (!document || seenKeys.has(document.key)) {
        return false;
      }
      seenKeys.add(document.key);
      return true;
    });
}
