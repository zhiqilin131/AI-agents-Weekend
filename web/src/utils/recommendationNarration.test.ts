import { describe, expect, it } from 'vitest';
import {
  bubbleTextFromReasoning,
  conciseReasoningPreview,
  isLongReasoning,
  speechTextFromRecommendation,
} from './recommendationNarration';

describe('recommendationNarration', () => {
  it('bubbleTextFromReasoning uses first sentence when present', () => {
    expect(bubbleTextFromReasoning('First part. Second part.', 'T')).toBe('First part.');
  });

  it('speechTextFromRecommendation joins title, bubble, and first action', () => {
    expect(speechTextFromRecommendation('Pick A', 'Because reasons.', 'Do the thing')).toBe(
      'Pick A. Because reasons. Next step: Do the thing',
    );
  });

  it('isLongReasoning respects threshold', () => {
    const short = 'x'.repeat(100);
    const long = 'y'.repeat(500);
    expect(isLongReasoning(short)).toBe(false);
    expect(isLongReasoning(long)).toBe(true);
  });

  it('conciseReasoningPreview truncates with ellipsis', () => {
    const body = `${'word '.repeat(120)}end`;
    const p = conciseReasoningPreview(body, 80);
    expect(p.endsWith('…')).toBe(true);
    expect(p.length).toBeLessThanOrEqual(85);
  });
});
