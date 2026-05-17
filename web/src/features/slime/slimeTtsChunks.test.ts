import { describe, expect, it } from 'vitest';
import {
  firstSpeakableChunk,
  firstSpeakableSentence,
  ttsPrefetchMatchesFinal,
} from './slimeTtsChunks';

describe('slimeTtsChunks', () => {
  it('firstSpeakableSentence waits for sentence end', () => {
    const partial = firstSpeakableSentence('Rose is your girlfriend and you two');
    expect(partial).toBe('');
    const full = firstSpeakableSentence(
      'Rose is your girlfriend and you two plan visits. She lives nearby.',
    );
    expect(full).toContain('Rose is your girlfriend');
    expect(full.endsWith('.')).toBe(true);
  });

  it('firstSpeakableChunk prefers a full sentence', () => {
    const chunk = firstSpeakableChunk(
      "I'm really sorry to hear about your hamster. Losing a pet is hard.",
    );
    expect(chunk).toContain('hamster');
    expect(chunk.endsWith('.')).toBe(true);
  });

  it('matches prefetch prefix when final text grows', () => {
    const pref = 'Rose is your girlfriend and';
    const fin = 'Rose is your girlfriend and you plan October visits.';
    expect(ttsPrefetchMatchesFinal(pref, fin)).toBe(true);
  });
});
