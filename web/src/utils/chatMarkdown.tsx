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

function isListBlock(block: string): boolean {
  const lines = block.split('\n').filter((l) => l.trim().length > 0);
  return lines.length > 0 && lines.every((l) => /^\s*[-*]\s+/.test(l));
}

function stripListMarker(line: string): string {
  return line.replace(/^\s*[-*]\s+/, '');
}

function isHeadingBlock(block: string): boolean {
  const t = block.trim();
  return /^#{1,4}\s+\S/.test(t) && !/\n/.test(t);
}

function headingLevel(block: string): 3 | 4 {
  const m = block.trim().match(/^(#{1,4})\s+/);
  const n = m?.[1].length ?? 4;
  return n <= 3 ? 3 : 4;
}

function stripHeadingPrefix(block: string): string {
  return block.trim().replace(/^#{1,4}\s+/, '');
}

/** Single-line inline markdown (**bold**, *italic*, `code`). */
export function renderChatMarkdownInline(text: string, keyPrefix = 'inline'): ReactNode {
  const t = text.trim();
  if (!t) return null;
  return <>{renderInline(t, keyPrefix)}</>;
}

/** Lightweight markdown for assistant chat bubbles (**bold**, *italic*, `code`, `>` quotes). */
export function renderChatMarkdown(content: string): ReactNode {
  const trimmed = content.trim();
  if (!trimmed) return '\u00a0';

  const blocks = trimmed.split(/\n\n+/);
  return blocks.map((block, blockIdx) => {
    const key = `b${blockIdx}`;
    if (isHeadingBlock(block)) {
      const level = headingLevel(block);
      const text = stripHeadingPrefix(block);
      const className =
        level === 3
          ? 'm-0 text-base font-semibold text-gray-900'
          : 'm-0 text-sm font-semibold text-gray-900';
      const Tag = level === 3 ? 'h3' : 'h4';
      return (
        <Tag key={key} className={className}>
          {renderInline(text, key)}
        </Tag>
      );
    }
    if (isListBlock(block)) {
      const lines = block.split('\n').filter((l) => l.trim().length > 0);
      return (
        <ul key={key} className="m-0 list-disc space-y-1.5 pl-5">
          {lines.map((line, lineIdx) => (
            <li key={`${key}-li${lineIdx}`} className="leading-relaxed">
              {renderInline(stripListMarker(line), `${key}-li${lineIdx}`)}
            </li>
          ))}
        </ul>
      );
    }
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
