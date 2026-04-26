import PropTypes from 'prop-types';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';

function parseInline(text) {
  const tokens = [];
  const regex = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^\)]+\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }

    const rawToken = match[0];

    if (rawToken.startsWith('**')) {
      tokens.push({ type: 'bold', value: rawToken.slice(2, -2) });
    } else {
      const linkMatch = rawToken.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
      if (linkMatch) {
        tokens.push({ type: 'link', label: linkMatch[1], href: linkMatch[2] });
      } else {
        tokens.push({ type: 'text', value: rawToken });
      }
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return tokens;
}

function InlineMarkdown({ text }) {
  const tokens = parseInline(text);

  return tokens.map((token, index) => {
    if (token.type === 'bold') {
      return <strong key={`${token.value}-${index}`}>{token.value}</strong>;
    }

    if (token.type === 'link') {
      if (token.href.startsWith('/')) {
        return (
          <Link key={`${token.href}-${index}`} to={token.href}>
            {token.label}
          </Link>
        );
      }

      return (
        <a
          key={`${token.href}-${index}`}
          href={token.href}
          target="_blank"
          rel="noreferrer"
        >
          {token.label}
        </a>
      );
    }

    return <Fragment key={`${token.value}-${index}`}>{token.value}</Fragment>;
  });
}

InlineMarkdown.propTypes = {
  text: PropTypes.string.isRequired
};

function MarkdownArticle({ markdown }) {
  const lines = markdown.split('\n');
  const blocks = [];
  let currentParagraph = [];
  let currentList = [];

  function flushParagraph() {
    if (currentParagraph.length > 0) {
      blocks.push({ type: 'paragraph', text: currentParagraph.join(' ') });
      currentParagraph = [];
    }
  }

  function flushList() {
    if (currentList.length > 0) {
      blocks.push({ type: 'list', items: [...currentList] });
      currentList = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith('## ')) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'h2', text: line.replace('## ', '') });
      continue;
    }

    if (line.startsWith('### ')) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'h3', text: line.replace('### ', '') });
      continue;
    }

    if (line.startsWith('- ')) {
      flushParagraph();
      currentList.push(line.replace('- ', ''));
      continue;
    }

    flushList();
    currentParagraph.push(line);
  }

  flushParagraph();
  flushList();

  return (
    <article className="legal-markdown-content">
      {blocks.map((block, index) => {
        if (block.type === 'h2') {
          return (
            <h2 key={`${block.type}-${index}`} className="h4 mt-4">
              <InlineMarkdown text={block.text} />
            </h2>
          );
        }

        if (block.type === 'h3') {
          return (
            <h3 key={`${block.type}-${index}`} className="h5 mt-3">
              <InlineMarkdown text={block.text} />
            </h3>
          );
        }

        if (block.type === 'list') {
          return (
            <ul key={`${block.type}-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>
                  <InlineMarkdown text={item} />
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={`${block.type}-${index}`}>
            <InlineMarkdown text={block.text} />
          </p>
        );
      })}
    </article>
  );
}

MarkdownArticle.propTypes = {
  markdown: PropTypes.string.isRequired
};

export default MarkdownArticle;
