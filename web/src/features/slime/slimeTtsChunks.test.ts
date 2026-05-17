import { describe, expect, it } from 'vitest';
import {
  firstSpeakableChunk,
  firstSpeakableSentence,
  remainderAfterSpokenPrefix,
  splitSpeakableParts,
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

  it('remainderAfterSpokenPrefix returns second sentence', () => {
    const full =
      'It sounds like you are still anxious. That can be really tough when feelings are intense.';
    const first = firstSpeakableSentence(full)!;
    expect(remainderAfterSpokenPrefix(full, first)).toBe(
      'That can be really tough when feelings are intense.',
    );
  });

  it('splitSpeakableParts splits on sentence boundaries', () => {
    const parts = splitSpeakableParts('First line. Second line here?');
    expect(parts).toEqual(['First line.', 'Second line here?']);
  });

  it('matches prefetch prefix when final text grows', () => {
    const pref = 'Rose is your girlfriend and';
    const fin = 'Rose is your girlfriend and you plan October visits.';
    expect(ttsPrefetchMatchesFinal(pref, fin)).toBe(true);
  });
});
