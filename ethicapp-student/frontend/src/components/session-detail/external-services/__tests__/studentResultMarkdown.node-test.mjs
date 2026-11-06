import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRichTextTree } from '../../../../utils/richTextElements.js';
import { parseStudentResultMarkdown } from '../student-result/studentResultMarkdown.js';
import { EXAMPLE_NAMES, studentResultExample } from './fixtures.mjs';

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
  if (node.type === 'br') {
    return '<br>';
  }
  const attributes = Object.entries(node.props ?? {})
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('');
  return `<${node.type}${attributes}>${node.children.map(serialize).join('')}</${node.type}>`;
}

function elements(text) {
  return renderRichTextTree(parseStudentResultMarkdown(text), h);
}

const render = (text) => elements(text).map(serialize).join('');

function eachElement(node, visit) {
  if (typeof node === 'string') {
    return;
  }
  visit(node);
  node.children.forEach((child) => eachElement(child, visit));
}

test('renders bold and italics', () => {
  assert.equal(
    render('**Evidence** is *specific*.'),
    '<p><strong>Evidence</strong> is <em>specific</em>.</p>'
  );
  assert.equal(render('***both***'), '<p><em><strong>both</strong></em></p>');
});

test('renders paragraphs, line breaks and lists', () => {
  assert.equal(render('One\ntwo\n\nThree'), '<p>One<br>two</p><p>Three</p>');
  assert.equal(render('Parts:\n\n- **Claim**: a\n- *Evidence*: b'),
    '<p>Parts:</p><ul><li><strong>Claim</strong>: a</li><li><em>Evidence</em>: b</li></ul>');
  assert.equal(render('1. first\n2. second'), '<ol><li>first</li><li>second</li></ol>');
  assert.equal(render('3. third\n4. fourth'), '<ol start="3"><li>third</li><li>fourth</li></ol>');
  assert.equal(render('\\*not italics\\*'), '<p>*not italics*</p>');
});

test('shows a link, an image and an HTML tag as text', () => {
  assert.equal(
    render('[the case](https://example.org/case)'),
    '<p>[the case](https://example.org/case)</p>'
  );
  assert.equal(
    render('![diagram](https://example.org/a.png)'),
    '<p>![diagram](https://example.org/a.png)</p>'
  );
  assert.equal(render('<b>bold</b> <img src=x onerror="alert(1)">'),
    '<p>&lt;b&gt;bold&lt;/b&gt; &lt;img src=x onerror="alert(1)"&gt;</p>');
});

test('shows every other construct as text', () => {
  assert.equal(
    render('https://example.org <https://example.org>'),
    '<p>https://example.org &lt;https://example.org&gt;</p>'
  );
  assert.equal(
    render('# Heading\n`code` &amp; ~~strike~~'),
    '<p># Heading<br>`code` &amp;amp; ~~strike~~</p>'
  );
  assert.equal(
    render('> quote\n\n---\n\n    indented'),
    '<p>&gt; quote</p><p>---</p><p>indented</p>'
  );
  assert.equal(render('| a | b |\n| - | - |'), '<p>| a | b |<br>| - | - |</p>');
});

test('the contract examples yield only the subset elements, with no attributes but start', () => {
  for (const name of EXAMPLE_NAMES) {
    const document = studentResultExample(name);
    const texts = [
      document.overview,
      ...document.sections.flatMap((section) => (section.kind === 'criteria'
        ? section.items.map((item) => item.description)
        : []))
    ].filter(Boolean);

    for (const text of texts) {
      for (const node of elements(text)) {
        eachElement(node, (element) => {
          assert.ok(ALLOWED_TAGS.has(element.type), `${name}: <${element.type}>`);
          const names = Object.keys(element.props ?? {});
          assert.ok(
            names.length === 0 || (element.type === 'ol' && names.join() === 'start'),
            name
          );
        });
      }
    }
  }

  const overview = render(studentResultExample('tutor-analysis.en_US').overview);
  assert.match(overview, /^<p>We reviewed your argument/);
  assert.match(
    overview,
    /<ul><li><strong>Claim<\/strong>: the position you take on the question\.<\/li>/
  );
});

test('a missing or empty text yields no blocks', () => {
  assert.deepEqual(parseStudentResultMarkdown(undefined), []);
  assert.deepEqual(parseStudentResultMarkdown(''), []);
});
