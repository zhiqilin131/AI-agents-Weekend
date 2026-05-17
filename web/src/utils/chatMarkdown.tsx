import { Fragment, type ReactNode } from 'react';

const INLINE_RE = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const key = `${keyPrefix}-i${i++}`;
    if (match[2] != null) {
      nodes.push(
        <strong key={key} className="font-semibold text-gray-950">
          {match[2]}
        </strong>,
      );
    } else if (match[3] != null) {
      nodes.push(
        <em key={key} className="italic text-gray-800">
          {match[3]}
        </em>,
      );
    } else if (match[4] != null) {
      nodes.push(
        <code key={key} className="rounded bg-gray-100 px-1 py-0.5 text-[0.9em] font-medium text-indigo-900">
          {match[4]}
        </code>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : [text];
}

function isBlockquoteBlock(block: string): boolean {
  const lines = block.split('\n').filter((l) => l.trim().length > 0);
  return lines.length > 0 && lines.every((l) => /^\s*>/.test(l));
}

function stripBlockquotePrefix(line: string): string {
  return line.replace(/^\s*>\s?/, '');
}

/** Lightweight markdown for assistant chat bubbles (**bold**, *italic*, `code`, `>` quotes). */
export function renderChatMarkdown(content: string): ReactNode {
  const trimmed = content.trim();
  if (!trimmed) return '\u00a0';

  const blocks = trimmed.split(/\n\n+/);
  return blocks.map((block, blockIdx) => {
    const key = `b${blockIdx}`;
    if (isBlockquoteBlock(block)) {
      const quoteText = block
        .split('\n')
        .map(stripBlockquotePrefix)
        .join('\n')
        .trim();
      return (
        <blockquote
          key={key}
          className="my-1 border-l-[3px] border-indigo-300/90 bg-indigo-50/50 py-2 pl-3.5 pr-1 text-[15px] font-medium leading-snug text-indigo-950 not-italic"
        >
          {quoteText.split('\n').map((line, lineIdx) => (
            <Fragment key={`${key}-q${lineIdx}`}>
              {lineIdx > 0 ? <br /> : null}
              {renderInline(line, `${key}-q${lineIdx}`)}
            </Fragment>
          ))}
        </blockquote>
      );
    }

    const lines = block.split('\n');
    return (
      <p key={key} className="m-0">
        {lines.map((line, lineIdx) => (
          <Fragment key={`${key}-p${lineIdx}`}>
            {lineIdx > 0 ? <br /> : null}
            {renderInline(line, `${key}-p${lineIdx}`)}
          </Fragment>
        ))}
      </p>
    );
  });
}
