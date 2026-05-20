/** Pre-render fixes for Buddy slime speech bubbles (markdown → comic styling). */

/** Voice stream normalizes whitespace; restore paragraph blockquotes broken into inline `>`. */
export function repairInlineBlockquotes(text: string): string {
  return text.replace(/([.!?。！？])\s*>\s+/g, '$1\n\n> ');
}

export function hasSlimeBoldMarkdown(text: string): boolean {
  return /\*\*[^*]+\*\*/.test(text || '');
}

export function hasValidSlimeBlockquote(text: string): boolean {
  return /(?:^|\n\n)\s*>/m.test(text || '');
}

function highlightFirstPlainMatch(text: string, pattern: RegExp): { text: string; changed: boolean } {
  const match = text.match(pattern);
  const phrase = match?.[1]?.trim();
  if (!phrase || phrase.length < 8 || phrase.length > 96) return { text, changed: false };
  return { text: text.replace(phrase, `**${phrase}**`), changed: true };
}

const SLIME_ACTION_SENTENCE_RE =
  /(^|(?<=[.!?])\s+)([^.!?]*(?:would you|could we|could you|can we|can you|what do you think|want to try|small step|share what's on your mind|share more about|sit with those|sit with your|take a moment|reflecting on|if you'd like)[^.!?]*[.!?])/gi;

const EMPHASIS_PATTERNS = [
  /\b(I'm really sorry[^.!?]{0,120}[.!?])/i,
  /\b(feeling sad about [^,.!?]{8,80})/i,
  /\b(tough place to be)\b/i,
  /\b(hard on yourself)\b/i,
  /\b(not meeting the standards [^,.!?]{8,80})/i,
  /\b(already dealing with [^,.!?]{8,80})/i,
  /\b(without letting it define your worth)\b/i,
  /\b(labeling it as [^,.!?]{8,80})/i,
  /\b(fit into your life in a more positive way)\b/i,
  /\b(really heavy|that weight|the pressure that comes with it|not making progress|ups and downs|moment of focus)/i,
  /\b(part of you that [^,.!?]{8,90})/i,
  /\b(the part that [^,.!?]{8,90})/i,
  /\b(what matters [^,.!?]{8,90})/i,
];

function pickActionSentence(text: string): string | null {
  const candidates = Array.from(text.matchAll(SLIME_ACTION_SENTENCE_RE))
    .map((m) => m[2]?.trim())
    .filter((s): s is string => Boolean(s && s.length >= 12 && s.length <= 260));
  if (!candidates.length) return null;
  const inviting = candidates.filter((c) =>
    /if you'd like|would you|could you|can we|can you|take a moment|sit with|share more about|want to try|small step/i.test(c),
  );
  return inviting.at(-1) ?? candidates.at(-1) ?? null;
}

/**
 * Light markdown for slime comic bubbles: bold empathy phrases + blockquote “invitation”.
 * Safe when upstream text was whitespace-normalized (voice stream).
 */
export function autoHighlightSlimeSpeech(text: string): string {
  const raw = (text || '').trim();
  if (!raw) return text;

  let out = repairInlineBlockquotes(raw);

  if (!hasValidSlimeBlockquote(out)) {
    const action = pickActionSentence(out);
    if (action) {
      const idx = out.lastIndexOf(action);
      if (idx >= 0) {
        out = `${out.slice(0, idx)}\n\n> ${action}${out.slice(idx + action.length)}`;
        out = repairInlineBlockquotes(out);
      }
    }
  }

  const sections = out.split(/\n\n(?=>\s)/);
  let body = sections[0] ?? out;
  const tail = sections.length > 1 ? `\n\n${sections.slice(1).join('\n\n')}` : '';

  if (!hasSlimeBoldMarkdown(body)) {
    let highlights = 0;
    for (const pattern of EMPHASIS_PATTERNS) {
      if (highlights >= 5) break;
      const next = highlightFirstPlainMatch(body, pattern);
      if (next.changed) {
        body = next.text;
        highlights += 1;
      }
    }

    if (highlights === 0) {
      const firstInsight = body
        .split(/(?<=[.!?])\s+/)
        .find((s) => s.length >= 42 && s.length <= 150 && !/\?$/.test(s) && !/^hello\b/i.test(s.trim()));
      if (firstInsight) {
        const phrase = firstInsight
          .replace(/^It(?:'s| is)\s+/i, '')
          .replace(/^Sometimes,\s+/i, '')
          .split(/,\s+|\s+and\s+|\s+but\s+/)[0]
          .trim();
        if (phrase.length >= 16 && phrase.length <= 90) {
          body = body.replace(phrase, `**${phrase}**`);
        }
      }
    }
  }

  return `${body}${tail}`;
}
