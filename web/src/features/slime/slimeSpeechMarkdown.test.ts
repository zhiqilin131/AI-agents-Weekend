import { describe, expect, it } from 'vitest';
import { autoHighlightSlimeSpeech, repairInlineBlockquotes } from './slimeSpeechMarkdown';

const SAMPLE =
  "I'm really sorry to hear about your heartbreak, Bob. It's completely understandable to feel sad and overwhelmed. Breakups can bring up a lot of emotions, and it's okay to take your time to process them. There's no right or wrong way to feel about this situation. If you'd like, maybe we can just sit with those feelings for a moment, or you can share more about what you're experiencing. I'm here for you.";

describe('slimeSpeechMarkdown', () => {
  it('repairs collapsed blockquote markers from normalized stream text', () => {
    const withQuote = `${SAMPLE.split('If you')[0]}\n\n> If you'd like, maybe we can just sit with those feelings for a moment, or you can share more about what you're experiencing. I'm here for you.`;
    const normalized = withQuote.replace(/\n\n/g, ' ');
    expect(normalized).toMatch(/situation\.\s+> If/);
    const repaired = repairInlineBlockquotes(normalized);
    expect(repaired).toContain('situation.\n\n> If');
    expect(repaired).not.toMatch(/situation\. > If/);
  });

  it('wraps invitation sentences in a blockquote without leaving a bare >', () => {
    const out = autoHighlightSlimeSpeech(SAMPLE);
    expect(out).not.toMatch(/situation\. > If/);
    expect(out).toMatch(/\n\n>\s+If you'd like/i);
    expect(out).toContain("I'm here for you.");
  });

  it('bolds empathetic lead when no markdown yet', () => {
    const out = autoHighlightSlimeSpeech(SAMPLE);
    expect(out).toContain("**I'm really sorry");
    expect(out).toContain('heartbreak');
  });
});
