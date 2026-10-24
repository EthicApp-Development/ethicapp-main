import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseRichText } from '../richText.js';
import { renderRichTextTree } from '../richTextElements.js';

const ROOT = new URL('../../../../../', import.meta.url);
const { cases } = JSON.parse(readFileSync(new URL('canonical-schemas/rich-text/fixtures.json', ROOT), 'utf8'));
const ALLOWED_TAGS = new Set(['p', 'ul', 'ol', 'li', 'strong', 'em', 'br', 'a', 'span']);
const LINK_PROPS = { target: '_blank', rel: 'noopener noreferrer' };

// Stands in for React's createElement and the facade component.
const h = (type, props, ...children) => ({ type, props, children });
const VideoFacade = () => null;
const OPTIONS = { VideoFacade, newTabHint: 'opens in a new tab' };

function escape(text) {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

function serialize(node) {
  if (typeof node === 'string') {
    return escape(node);
  }
  const attributes = Object.entries(node.props ?? {}).map(([name, value]) => ` ${name}="${value}"`).join('');
  if (node.type === VideoFacade) {
    return `<VideoFacade${attributes}>`;
  }
  return node.type === 'br' ? '<br>' : `<${node.type}${attributes}>${node.children.map(serialize).join('')}</${node.type}>`;
}

const render = (text, contentType, options = OPTIONS) => renderRichTextTree(parseRichText(text, contentType), h, options)
  .map(serialize).join('');

function eachElement(node, visit) {
  if (typeof node === 'string') {
    return;
  }
  visit(node);
  if (node.type === VideoFacade) {
    return;
  }
  node.children.forEach((child) => eachElement(child, visit));
}

test('builds paragraphs, breaks, emphasis and lists (#766)', () => {
  assert.equal(render('**Lee** el *caso*\\\ny responde.\n\nDespués:', 'text/markdown'),
    '<p><strong>Lee</strong> el <em>caso</em><br>y responde.</p><p>Después:</p>');
  assert.equal(render('3. tres\n   - a\n4. cuatro', 'text/markdown'),
    '<ol start="3"><li>tres<ul><li>a</li></ul></li><li>cuatro</li></ol>');
  assert.equal(render('1. uno', 'text/markdown'), '<ol><li>uno</li></ol>');
  assert.equal(render('- uno\n\n  sigue\n- dos', 'text/markdown'),
    '<ul><li><p>uno</p><p>sigue</p></li><li>dos</li></ul>');
});

test('renders text/plain with its line breaks and nothing interpreted', () => {
  assert.equal(render('**no**\n- tampoco\n\nfin', 'text/plain'), '<p>**no**<br>- tampoco</p><p>fin</p>');
  assert.equal(render('**sin tipo**', undefined), '<p>**sin tipo**</p>');
});

// Only the attributes the contract allows: `start` on <ol>, the fixed link
// attributes, the hint's class, and the facade's id and title.
function assertAllowedProps(element, fixtureName) {
  const props = element.props ?? {};
  const names = Object.keys(props).sort().join();
  const message = `${fixtureName}: <${element.type?.name ?? element.type}> ${names}`;
  if (element.type === VideoFacade) {
    assert.equal(names, 'title,videoId', message);
    assert.match(props.videoId, /^[A-Za-z0-9_-]{11}$/u, message);
    return;
  }
  assert.ok(ALLOWED_TAGS.has(element.type), message);
  if (element.type === 'ol' && names) {
    assert.ok(names === 'start' && Number.isInteger(props.start), message);
  } else if (element.type === 'a') {
    assert.equal(names, 'href,rel,target', message);
    assert.match(props.href, /^https?:\/\/[^/?#]/iu, message);
    assert.deepEqual({ target: props.target, rel: props.rel }, LINK_PROPS, message);
  } else if (element.type === 'span') {
    assert.deepEqual(props, { className: 'visually-hidden' }, message);
  } else {
    assert.equal(names, '', message);
  }
}

test('every fixture yields text children and only the allowed elements', () => {
  for (const fixture of cases) {
    for (const node of renderRichTextTree(parseRichText(fixture.input, fixture.contentType), h, OPTIONS)) {
      eachElement(node, (element) => assertAllowedProps(element, fixture.name));
    }
  }
  assert.equal(render('<img src=x onerror="alert(1)">', 'text/markdown'), '<p>&lt;img src=x onerror="alert(1)"&gt;</p>');
});

test('renders links that open in a new tab with a hidden hint (#786)', () => {
  assert.equal(render('Lee [el **caso**](https://example.org/a?b=1&c=2) ahora', 'text/markdown'),
    '<p>Lee <a href="https://example.org/a?b=1&c=2" target="_blank" rel="noopener noreferrer">el <strong>caso</strong>'
    + '<span className="visually-hidden"> (opens in a new tab)</span></a> ahora</p>');
  assert.equal(render('- <https://example.org/b>', 'text/markdown', { VideoFacade }),
    '<ul><li><a href="https://example.org/b" target="_blank" rel="noopener noreferrer">https://example.org/b</a></li></ul>');
});

test('keeps rejected schemes as text and refuses unsafe hrefs in the tree', () => {
  assert.equal(render('[x](javascript:alert(1)) [y](mailto:a@example.org) <ftp://example.org>', 'text/markdown'),
    '<p>[x](javascript:alert(1)) [y](mailto:a@example.org) &lt;ftp://example.org&gt;</p>');
  for (const href of ['javascript:alert(1)', 'data:text/html,x', '//example.org', '/caso', 'https://', undefined]) {
    const tree = [{ type: 'paragraph', children: [{ type: 'link', href, children: [{ type: 'text', value: 'texto' }] }] }];
    assert.equal(renderRichTextTree(tree, h, OPTIONS).map(serialize).join(''), '<p>texto</p>', String(href));
  }
});

test('maps a video block to the facade with only its id and title (#786)', () => {
  const html = render('[El <video>](https://www.youtube.com/watch?v=M7lc1UVf-VE&t=30)', 'text/markdown');
  assert.equal(html, '<VideoFacade videoId="M7lc1UVf-VE" title="El <video>">');
  assert.doesNotMatch(html, /youtube\.com|youtu\.be|youtube-nocookie/u);
  const [facade] = renderRichTextTree(parseRichText('<https://youtu.be/M7lc1UVf-VE>', 'text/markdown'), h, OPTIONS);
  assert.deepEqual(facade, { type: VideoFacade, props: { videoId: 'M7lc1UVf-VE', title: 'https://youtu.be/M7lc1UVf-VE' }, children: [] });
});

test('shows a video as its title without a facade or with an invalid id', () => {
  assert.equal(render('[El video](https://youtu.be/M7lc1UVf-VE)', 'text/markdown', {}), '<p>El video</p>');
  const tree = [{ type: 'video', provider: 'youtube', videoId: 'x"><script>', title: 'T' }];
  assert.equal(renderRichTextTree(tree, h, OPTIONS).map(serialize).join(''), '<p>T</p>');
});

test('renders nothing for empty text or a missing tree', () => {
  assert.deepEqual(renderRichTextTree(parseRichText('', 'text/markdown'), h), []);
  assert.deepEqual(renderRichTextTree(undefined, h), []);
});
