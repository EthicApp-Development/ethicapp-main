import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseRichText } from '../richText.js';
import { renderRichTextTree } from '../richTextElements.js';

const ROOT = new URL('../../../../../', import.meta.url);
const { cases } = JSON.parse(readFileSync(new URL('canonical-schemas/rich-text/fixtures.json', ROOT), 'utf8'));
const ALLOWED_TAGS = new Set(['p', 'ul', 'ol', 'li', 'strong', 'em', 'br']);

// Stands in for React's createElement.
const h = (type, props, ...children) => ({ type, props, children });

function escape(text) {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

function serialize(node) {
  if (typeof node === 'string') {
    return escape(node);
  }
  const attributes = Object.entries(node.props ?? {}).map(([name, value]) => ` ${name}="${value}"`).join('');
  return node.type === 'br' ? '<br>' : `<${node.type}${attributes}>${node.children.map(serialize).join('')}</${node.type}>`;
}

const render = (text, contentType) => renderRichTextTree(parseRichText(text, contentType), h).map(serialize).join('');

function eachElement(node, visit) {
  if (typeof node === 'string') {
    return;
  }
  visit(node);
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

test('every fixture yields text children and only the allowed elements', () => {
  for (const fixture of cases) {
    for (const node of renderRichTextTree(parseRichText(fixture.input, fixture.contentType), h)) {
      eachElement(node, (element) => {
        assert.ok(ALLOWED_TAGS.has(element.type), `${fixture.name}: <${element.type}>`);
        const props = Object.keys(element.props ?? {});
        assert.ok(props.length === 0 || (element.type === 'ol' && props.join() === 'start'
          && Number.isInteger(element.props.start)), `${fixture.name}: props ${props.join()}`);
      });
    }
  }
  assert.equal(render('<img src=x onerror="alert(1)">', 'text/markdown'), '<p>&lt;img src=x onerror="alert(1)"&gt;</p>');
});

test('shows links as their text and videos as their title until #786', () => {
  const source = 'Lee [el **caso**](https://example.org) y <https://example.org/b>\n\n[El <video>](https://youtu.be/M7lc1UVf-VE)';
  assert.equal(render(source, 'text/markdown'),
    '<p>Lee el <strong>caso</strong> y https://example.org/b</p><p>El &lt;video&gt;</p>');
  assert.equal(render('- [uno](https://example.org)', 'text/markdown'), '<ul><li>uno</li></ul>');
});

test('renders nothing for empty text or a missing tree', () => {
  assert.deepEqual(renderRichTextTree(parseRichText('', 'text/markdown'), h), []);
  assert.deepEqual(renderRichTextTree(undefined, h), []);
});
