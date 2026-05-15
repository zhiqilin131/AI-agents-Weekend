import { describe, expect, it } from 'vitest';
import { firstSpeakableChunk, ttsPrefetchMatchesFinal } from './slimeTtsChunks';

describe('slimeTtsChunks', () => {
  it('starts prefetch earlier than a full sentence', () => {
    const chunk = firstSpeakableChunk('Rose is your girlfriend and you two');
    expect(chunk.length).toBeGreaterThanOrEqual(10);
    expect(chunk).toContain('Rose');
  });

  it('matches prefetch prefix when final text grows', () => {
    const pref = 'Rose is your girlfriend and';
    const fin = 'Rose is your girlfriend and you plan October visits.';
    expect(ttsPrefetchMatchesFinal(pref, fin)).toBe(true);
  });
});
