import { useEffect, useState } from 'react';

type TypewriterTextProps = {
  text: string;
  /** When false, show full text immediately (no animation). */
  enabled?: boolean;
  className?: string;
  /** Use block for paragraphs / whitespace-pre-wrap. */
  as?: 'p' | 'span' | 'div';
  charStep?: number;
  intervalMs?: number;
};

export function TypewriterText({
  text,
  enabled = true,
  className,
  as: Tag = 'span',
  charStep = 2,
  intervalMs = 12,
}: TypewriterTextProps) {
  const [display, setDisplay] = useState(enabled ? '' : text);

  useEffect(() => {
    if (!enabled) {
      setDisplay(text);
      return;
    }
    if (!text) {
      setDisplay('');
      return;
    }
    setDisplay('');
    let i = 0;
    const id = window.setInterval(() => {
      i += charStep;
      if (i >= text.length) {
        setDisplay(text);
        window.clearInterval(id);
      } else {
        setDisplay(text.slice(0, i));
      }
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [text, enabled, charStep, intervalMs]);

  const typing = enabled && text.length > 0 && display.length < text.length;

  return (
    <Tag className={className}>
      {display}
      {typing && (
        <span className="inline-block w-0.5 h-4 ml-0.5 bg-purple-500 animate-pulse align-middle" aria-hidden />
      )}
    </Tag>
  );
}
