#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const cssFiles = [
  'ethicapp/frontend/assets/css/custom.css',
  'ethicapp/frontend/assets/css/main.css',
];

const teacherContentRoots = [
  'ethicapp/backend/views/layouts/teacher-app.ejs',
  'ethicapp/backend/views/home.ejs',
  'ethicapp/backend/views/partials/profile.html',
  'ethicapp/frontend/assets/static/views/teacher',
  'ethicapp/frontend/assets/js/modules/teacher',
  'ethicapp/frontend/assets/js/controllers/teacher',
  'ethicapp/frontend/assets/js/components',
  'ethicapp/frontend/assets/js/directives',
  'ethicapp/frontend/assets/js/services',
  'ethicapp/frontend/assets/js/helpers',
];

const contentExtensions = new Set(['.ejs', '.html', '.js', '.mjs']);

const safelistPatterns = [
  /^active$/,
  /^disabled$/,
  /^open$/,
  /^fade$/,
  /^in$/,
  /^collapse$/,
  /^collapsing$/,
  /^hide$/,
  /^show$/,
  /^modal-/,
  /^popover/,
  /^tooltip/,
  /^dropdown/,
  /^caret$/,
  /^btn($|-)/,
  /^panel($|-)/,
  /^nav($|-)/,
  /^navbar($|-)/,
  /^container($|-)/,
  /^row$/,
  /^col-(xs|sm|md|lg)-/,
  /^form($|-)/,
  /^input-/,
  /^help-block$/,
  /^control-label$/,
  /^has-/,
  /^alert($|-)/,
  /^label($|-)/,
  /^badge($|-)/,
  /^text-/,
  /^bg-/,
  /^table($|-)/,
  /^thumbnail$/,
  /^well($|-)/,
  /^list-group/,
  /^pull-/,
  /^center-block$/,
  /^clearfix$/,
  /^sr-only/,
  /^visible-/,
  /^hidden-/,
  /^glyphicon/,
  /^fa($|-)/,
  /^fa[bsrl]$/,
  /^fa-(solid|regular|brands)$/,
  /^ng-/,
  /^ngdialog/,
  /^ui-/,
  /^angular-ui-/,
  /^introjs/,
  /^nv/,
  /^nvd3/,
];

const args = new Set(process.argv.slice(2));
const outputJson = args.has('--json');
const showHelp = args.has('--help') || args.has('-h');
const maxExamples = Number.parseInt(
  process.argv.find((arg) => arg.startsWith('--max-examples='))?.split('=')[1] || '5',
  10,
);

if (showHelp) {
  console.log(`Usage: node scripts/audit-teacher-css.mjs [--json] [--max-examples=N]

Audits class/id selectors from custom.css and main.css against teacher-facing
AngularJS templates, components, directives, controllers, services, and helpers.

This is a conservative static report. It does not modify CSS.`);
  process.exit(0);
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function walk(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    return contentExtensions.has(path.extname(relativePath)) ? [relativePath] : [];
  }

  return fs.readdirSync(absolutePath, { withFileTypes: true })
    .flatMap((entry) => {
      const child = path.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        return walk(child);
      }
      return contentExtensions.has(path.extname(entry.name)) ? [child] : [];
    });
}

function lineForIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length));
}

function findMatchingBrace(css, openIndex) {
  let depth = 0;
  let quote = null;

  for (let i = openIndex; i < css.length; i += 1) {
    const char = css[i];
    const previous = css[i - 1];

    if (quote) {
      if (char === quote && previous !== '\\') {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function collectRules(css, sourceFile, offset = 0) {
  const rules = [];
  let cursor = 0;

  while (cursor < css.length) {
    const openIndex = css.indexOf('{', cursor);
    if (openIndex === -1) {
      break;
    }

    const closeIndex = findMatchingBrace(css, openIndex);
    if (closeIndex === -1) {
      break;
    }

    const preludeStart = Math.max(css.lastIndexOf('}', openIndex - 1), css.lastIndexOf(';', openIndex - 1)) + 1;
    const prelude = css.slice(preludeStart, openIndex).trim();
    const body = css.slice(openIndex + 1, closeIndex);
    const line = lineForIndex(css, openIndex) + lineForIndex(css.slice(0, offset), offset) - 1;

    if (prelude.startsWith('@')) {
      if (/^@(media|supports|container|layer|document)\b/.test(prelude)) {
        rules.push(...collectRules(body, sourceFile, offset + openIndex + 1));
      }
    } else if (prelude) {
      rules.push({
        sourceFile,
        line,
        selectorText: prelude.replace(/\s+/g, ' '),
      });
    }

    cursor = closeIndex + 1;
  }

  return rules;
}

function splitSelectors(selectorText) {
  const selectors = [];
  let depth = 0;
  let quote = null;
  let start = 0;

  for (let i = 0; i < selectorText.length; i += 1) {
    const char = selectorText[i];
    const previous = selectorText[i - 1];

    if (quote) {
      if (char === quote && previous !== '\\') {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(' || char === '[') {
      depth += 1;
    } else if (char === ')' || char === ']') {
      depth = Math.max(0, depth - 1);
    } else if (char === ',' && depth === 0) {
      selectors.push(selectorText.slice(start, i).trim());
      start = i + 1;
    }
  }

  selectors.push(selectorText.slice(start).trim());
  return selectors.filter(Boolean);
}

function extractSelectorTokens(selector) {
  const tokens = [];
  const tokenPattern = /([.#])(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g;
  let match;

  while ((match = tokenPattern.exec(selector)) !== null) {
    const previous = selector[match.index - 1];
    if (previous === '\\' || previous === ':' || previous === '@') {
      continue;
    }
    tokens.push({
      kind: match[1] === '.' ? 'class' : 'id',
      name: match[2],
    });
  }

  return tokens;
}

function buildContentIndex(files) {
  return files.map((file) => ({
    file,
    text: readText(file),
  }));
}

function findReferences(name, contentIndex) {
  const references = [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactPattern = new RegExp(`(^|[^_a-zA-Z0-9-])${escaped}([^_a-zA-Z0-9-]|$)`);

  for (const entry of contentIndex) {
    if (exactPattern.test(entry.text)) {
      references.push(entry.file);
    }
  }

  return references;
}

function safelistReason(name) {
  const matched = safelistPatterns.find((pattern) => pattern.test(name));
  return matched ? `matches safelist pattern ${matched}` : null;
}

function uniqueBy(items, getKey) {
  const seen = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!seen.has(key)) {
      seen.set(key, item);
    }
  }
  return [...seen.values()];
}

function audit() {
  const missingCssFiles = cssFiles.filter((file) => !exists(file));
  if (missingCssFiles.length > 0) {
    throw new Error(`Missing CSS file(s): ${missingCssFiles.join(', ')}`);
  }

  const contentFiles = uniqueBy(teacherContentRoots.flatMap(walk), (file) => file).sort();
  const contentIndex = buildContentIndex(contentFiles);
  const cssRules = cssFiles.flatMap((file) => collectRules(stripCssComments(readText(file)), file));

  const selectorEntries = cssRules.flatMap((rule) => splitSelectors(rule.selectorText).map((selector) => ({
    ...rule,
    selector,
    tokens: extractSelectorTokens(selector),
  })));

  const tokenEntries = selectorEntries.flatMap((entry) => entry.tokens.map((token) => ({
    ...token,
    selector: entry.selector,
    selectorText: entry.selectorText,
    sourceFile: entry.sourceFile,
    line: entry.line,
  })));

  const grouped = new Map();
  for (const entry of tokenEntries) {
    const key = `${entry.kind}:${entry.name}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        kind: entry.kind,
        name: entry.name,
        selectors: [],
      });
    }

    grouped.get(key).selectors.push({
      sourceFile: entry.sourceFile,
      line: entry.line,
      selector: entry.selector,
    });
  }

  const tokens = [...grouped.values()].map((entry) => {
    const references = findReferences(entry.name, contentIndex);
    const safeReason = safelistReason(entry.name);
    const status = references.length > 0
      ? 'referenced'
      : safeReason
        ? 'safelisted'
        : 'suspicious';

    return {
      ...entry,
      selectors: uniqueBy(entry.selectors, (selector) => `${selector.sourceFile}:${selector.line}:${selector.selector}`),
      references,
      safeReason,
      status,
    };
  }).sort((a, b) => {
    if (a.status !== b.status) {
      return a.status.localeCompare(b.status);
    }
    return a.name.localeCompare(b.name);
  });

  const globalSelectors = selectorEntries
    .filter((entry) => entry.tokens.length === 0)
    .map((entry) => ({
      sourceFile: entry.sourceFile,
      line: entry.line,
      selector: entry.selector,
    }));

  return {
    cssFiles,
    contentRoots: teacherContentRoots,
    contentFileCount: contentFiles.length,
    contentFiles,
    selectorCount: selectorEntries.length,
    tokenCount: tokens.length,
    counts: {
      referenced: tokens.filter((entry) => entry.status === 'referenced').length,
      safelisted: tokens.filter((entry) => entry.status === 'safelisted').length,
      suspicious: tokens.filter((entry) => entry.status === 'suspicious').length,
      globalSelectors: globalSelectors.length,
    },
    tokens,
    globalSelectors,
  };
}

function formatSelectorExamples(selectors) {
  return selectors
    .slice(0, maxExamples)
    .map((selector) => `    - ${selector.sourceFile}:${selector.line} \`${selector.selector}\``)
    .join('\n');
}

function formatTokenList(title, entries, includeReference = false) {
  const lines = [`## ${title}`, ''];
  if (entries.length === 0) {
    lines.push('_No hay resultados en esta categoría._', '');
    return lines.join('\n');
  }

  for (const entry of entries) {
    const marker = entry.kind === 'class' ? '.' : '#';
    lines.push(`- \`${marker}${entry.name}\``);
    if (entry.safeReason) {
      lines.push(`  - Motivo: ${entry.safeReason}`);
    }
    if (includeReference && entry.references.length > 0) {
      lines.push(`  - Referencias: ${entry.references.slice(0, maxExamples).join(', ')}`);
    }
    lines.push('  - Selectores:');
    lines.push(formatSelectorExamples(entry.selectors));
  }

  lines.push('');
  return lines.join('\n');
}

function toMarkdown(report) {
  const suspicious = report.tokens.filter((entry) => entry.status === 'suspicious');
  const safelisted = report.tokens.filter((entry) => entry.status === 'safelisted');
  const referenced = report.tokens.filter((entry) => entry.status === 'referenced');

  return [
    '# Teacher CSS Audit',
    '',
    'Static audit for `custom.css` and `main.css` against teacher-facing templates and JavaScript.',
    '',
    '> This report is intentionally conservative. Treat suspicious selectors as review candidates, not automatic deletions.',
    '',
    '## Summary',
    '',
    `- CSS files: ${report.cssFiles.join(', ')}`,
    `- Teacher content files scanned: ${report.contentFileCount}`,
    `- Selector entries parsed: ${report.selectorCount}`,
    `- Unique class/id tokens: ${report.tokenCount}`,
    `- Referenced tokens: ${report.counts.referenced}`,
    `- Safelisted tokens: ${report.counts.safelisted}`,
    `- Suspicious tokens: ${report.counts.suspicious}`,
    `- Global/no-token selectors: ${report.counts.globalSelectors}`,
    '',
    formatTokenList('Suspicious Selectors', suspicious),
    formatTokenList('Safelisted / Dynamic Selectors', safelisted),
    formatTokenList('Referenced Selectors', referenced, true),
    '## Global Or Structural Selectors',
    '',
    ...report.globalSelectors.slice(0, 80).map((selector) => `- ${selector.sourceFile}:${selector.line} \`${selector.selector}\``),
    report.globalSelectors.length > 80 ? `- ... ${report.globalSelectors.length - 80} more` : '',
    '',
  ].filter((line) => line !== null).join('\n');
}

try {
  const report = audit();
  if (outputJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(toMarkdown(report));
  }
} catch (error) {
  console.error(`CSS audit failed: ${error.message}`);
  process.exit(1);
}
