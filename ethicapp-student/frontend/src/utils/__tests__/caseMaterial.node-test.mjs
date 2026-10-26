import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CASE_DOCUMENT_DISPLAY,
  CASE_DOCUMENT_TYPE_ICONS,
  caseDocumentType,
  caseMaterialDocuments,
  caseMaterialVideos,
  isLongVideoDescription
} from '../caseMaterial.js';

const ID_A = 'dQw4w9WgXcQ';
const ID_B = '9bZkp7q19f0';
const ID_C = 'kJQP7kiw5Fk';

const metadata = (overrides = {}) => ({
  title: 'Dilema',
  description: 'Primera línea\nSegunda línea',
  channelTitle: 'Canal',
  durationSeconds: 205,
  availability: 'available',
  ...overrides
});

const caseVideo = (youtubeVideoId, position, videoMetadata = metadata()) => ({
  youtubeVideoId,
  position,
  url: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
  metadata: videoMetadata
});

test('lists nothing for cases without videos', () => {
  for (const videos of [undefined, null, [], 'not a list', {}]) {
    assert.deepEqual(caseMaterialVideos(videos), [], JSON.stringify(videos));
  }
});

test("lists the videos in the case's order, keeping the API order for ties", () => {
  const videos = [caseVideo(ID_C, 2), caseVideo(ID_A, 0), caseVideo(ID_B, 1)];
  assert.deepEqual(caseMaterialVideos(videos).map((video) => video.videoId), [ID_A, ID_B, ID_C]);
  const unordered = [caseVideo(ID_B, undefined), caseVideo(ID_A, undefined)];
  assert.deepEqual(caseMaterialVideos(unordered).map((video) => video.videoId), [ID_B, ID_A]);
});

test('keeps the title and description as plain text, trimmed', () => {
  const [video] = caseMaterialVideos([caseVideo(ID_A, 0, metadata({
    title: '  <b>Dilema</b> ',
    description: ' <script>x</script>\nfin '
  }))]);
  assert.deepEqual(video, {
    videoId: ID_A,
    watchUrl: `https://www.youtube.com/watch?v=${ID_A}`,
    title: '<b>Dilema</b>',
    description: '<script>x</script>\nfin',
    hasLongDescription: false,
    hasMetadata: true
  });
});

test('flags videos without metadata, which show their watch link', () => {
  const [video] = caseMaterialVideos([caseVideo(ID_B, 0, null)]);
  assert.deepEqual(video, {
    videoId: ID_B,
    watchUrl: `https://www.youtube.com/watch?v=${ID_B}`,
    title: '',
    description: '',
    hasLongDescription: false,
    hasMetadata: false
  });
});

test('keeps unavailable videos, whose facade shows the notice', () => {
  const [video] = caseMaterialVideos([caseVideo(ID_A, 0, metadata({
    title: null,
    description: null,
    availability: 'removed'
  }))]);
  assert.equal(video.hasMetadata, true);
  assert.equal(video.title, '');
  assert.equal(video.description, '');
});

test("builds the watch link from the id and leaves out invalid ids", () => {
  const videos = [
    { ...caseVideo(ID_A, 0), url: 'javascript:alert(1)' },
    caseVideo('"><script>', 1),
    null,
    { position: 3 }
  ];
  assert.deepEqual(caseMaterialVideos(videos).map((video) => video.watchUrl),
    [`https://www.youtube.com/watch?v=${ID_A}`]);
});

test('collapses long descriptions only', () => {
  assert.equal(isLongVideoDescription('x'.repeat(281)), true);
  assert.equal(isLongVideoDescription('1\n2\n3\n4\n5'), true);
  assert.equal(isLongVideoDescription('1\n2\n3\n4'), false);
  assert.equal(isLongVideoDescription('breve'), false);
  assert.equal(isLongVideoDescription(null), false);
});

const FILE_ID_A = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const FILE_ID_B = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa987654';
const PUBLISHED_ID = '2PACX-1vQabcdefghijklmnopqrstuvwxyz0123456789';

const availability = (overrides = {}) => ({
  status: 'available',
  name: 'Informe',
  mimeType: 'application/vnd.google-apps.document',
  modifiedTime: '2026-10-20T12:00:00.000Z',
  ...overrides
});

function documentUrl(kind, product, id) {
  if (kind === 'published') {
    return `https://docs.google.com/${product}/d/e/${id}/${product === 'spreadsheets' ? 'pubhtml' : 'pub'}`;
  }
  return product === 'file'
    ? `https://drive.google.com/file/d/${id}/preview`
    : `https://docs.google.com/${product}/d/${id}/preview`;
}

const caseDocument = (product, id, position, documentAvailability = availability(), kind = 'drive_file') => ({
  kind,
  product,
  id,
  resourceKey: null,
  position,
  url: documentUrl(kind, product, id),
  availability: documentAvailability
});

test('lists no documents for cases without them', () => {
  for (const documents of [undefined, null, [], 'not a list', {}]) {
    assert.deepEqual(caseMaterialDocuments(documents), [], JSON.stringify(documents));
  }
});

test("lists the documents in the case's order, keeping the API order for ties", () => {
  const documents = [
    caseDocument('spreadsheets', FILE_ID_B, 3),
    caseDocument('document', FILE_ID_A, 1),
    caseDocument('presentation', PUBLISHED_ID, 2, availability(), 'published')
  ];
  assert.deepEqual(caseMaterialDocuments(documents).map((document) => document.key),
    [`drive_file:${FILE_ID_A}`, `published:${PUBLISHED_ID}`, `drive_file:${FILE_ID_B}`]);
  const unordered = [caseDocument('file', FILE_ID_B, undefined), caseDocument('file', FILE_ID_A, undefined)];
  assert.deepEqual(caseMaterialDocuments(unordered).map((document) => document.key),
    [`drive_file:${FILE_ID_B}`, `drive_file:${FILE_ID_A}`]);
});

test('links an available document with its name as plain text', () => {
  const document = caseDocument('document', FILE_ID_A, 1, availability({ name: ' <b>Informe</b> ' }));
  assert.deepEqual(caseMaterialDocuments([document]), [{
    key: `drive_file:${FILE_ID_A}`,
    url: `https://docs.google.com/document/d/${FILE_ID_A}/preview`,
    name: '<b>Informe</b>',
    linkText: '<b>Informe</b>',
    type: 'document',
    icon: 'fa-file-word',
    display: CASE_DOCUMENT_DISPLAY.link,
    status: 'available'
  }]);
});

test('labels an available document without a name with its URL', () => {
  const document = caseDocument('spreadsheets', PUBLISHED_ID, 1,
    availability({ name: null, mimeType: null }), 'published');
  const [item] = caseMaterialDocuments([document]);
  assert.equal(item.name, '');
  assert.equal(item.linkText, `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_ID}/pubhtml`);
  assert.equal(item.display, CASE_DOCUMENT_DISPLAY.link);
});

test('marks documents that are not public or not found as unavailable', () => {
  for (const status of ['not_public', 'not_found']) {
    const [item] = caseMaterialDocuments([caseDocument('presentation', FILE_ID_A, 1,
      { status, name: null, mimeType: null, modifiedTime: null })]);
    assert.equal(item.display, CASE_DOCUMENT_DISPLAY.unavailable, status);
    assert.equal(item.status, status);
    assert.equal(item.name, '');
  }
});

test('marks documents of unknown availability as unverified, labeled with their URL', () => {
  for (const documentAvailability of [null, 'available', { status: 'unavailable' }, {}]) {
    const [item] = caseMaterialDocuments([caseDocument('document', FILE_ID_A, 1, documentAvailability)]);
    const label = JSON.stringify(documentAvailability);
    assert.equal(item.display, CASE_DOCUMENT_DISPLAY.unverified, label);
    assert.equal(item.status, null, label);
    assert.equal(item.linkText, `https://docs.google.com/document/d/${FILE_ID_A}/preview`, label);
  }
});

test("keeps the API's canonical URL, with its resource key", () => {
  const document = {
    ...caseDocument('file', FILE_ID_A, 1),
    resourceKey: '0-AbC_d',
    url: `https://drive.google.com/file/d/${FILE_ID_A}/preview?resourcekey=0-AbC_d`
  };
  assert.equal(caseMaterialDocuments([document])[0].url, document.url);
});

test('leaves out entries whose URL is not a canonical Google document URL, and repeats', () => {
  const valid = caseDocument('document', FILE_ID_A, 9);
  const documents = [
    { ...caseDocument('document', FILE_ID_B, 1), url: 'javascript:alert(1)' },
    { ...caseDocument('document', FILE_ID_B, 2), url: `https://docs.google.com/document/d/${FILE_ID_B}/edit` },
    { ...caseDocument('document', FILE_ID_B, 3), url: `http://docs.google.com/document/d/${FILE_ID_B}/preview` },
    { ...caseDocument('document', FILE_ID_B, 4), url: `https://evil.example/document/d/${FILE_ID_B}/preview` },
    { ...caseDocument('document', FILE_ID_B, 5), url: null },
    null,
    'text',
    valid,
    { ...valid, position: 10 }
  ];
  assert.deepEqual(caseMaterialDocuments(documents).map((document) => document.url), [valid.url]);
});

test('picks the type and icon by product, and by MIME type for other Drive files', () => {
  const cases = [
    ['document', null, 'document'],
    ['spreadsheets', null, 'spreadsheet'],
    ['presentation', null, 'presentation'],
    ['file', 'application/pdf', 'pdf'],
    ['file', 'image/png', 'file'],
    ['file', null, 'file']
  ];
  for (const [product, mimeType, type] of cases) {
    assert.equal(caseDocumentType(product, mimeType), type, `${product} ${mimeType}`);
  }
  assert.deepEqual(CASE_DOCUMENT_TYPE_ICONS, {
    document: 'fa-file-word',
    spreadsheet: 'fa-file-excel',
    presentation: 'fa-file-powerpoint',
    pdf: 'fa-file-pdf',
    file: 'fa-file'
  });
  const pdf = caseDocument('file', FILE_ID_A, 1, availability({ mimeType: 'application/pdf' }));
  const unknownFile = caseDocument('file', FILE_ID_B, 2, null);
  assert.deepEqual(caseMaterialDocuments([pdf, unknownFile]).map((document) => [document.type, document.icon]),
    [['pdf', 'fa-file-pdf'], ['file', 'fa-file']]);
});
