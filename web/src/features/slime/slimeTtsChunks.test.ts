import { describe, expect, it } from 'vitest';
import {
  firstSpeakableChunk,
  firstSpeakableSentence,
  newlyCompleteSpeakableParts,
  remainderAfterSpokenPrefix,
  groupSpeakableParts,
  splitSpeakableParts,
  ttsPrefetchMatchesFinal,
  tailSpeakablePartsAfterQueue,
  unqueuedSpeakableParts,
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

  it('groupSpeakableParts merges short adjacent sentences', () => {
    const parts = splitSpeakableParts('One. Two. Three. Four.');
    const grouped = groupSpeakableParts(parts, 80, 4);
    expect(grouped.length).toBeLessThan(parts.length);
    expect(grouped.join(' ')).toContain('Four.');
  });

  it('matches prefetch prefix when final text grows', () => {
    const pref = 'Rose is your girlfriend and';
    const fin = 'Rose is your girlfriend and you plan October visits.';
    expect(ttsPrefetchMatchesFinal(pref, fin)).toBe(true);
  });

  it('newlyCompleteSpeakableParts waits for punctuation', () => {
    const partial = 'Stay with me. Feet on the floor';
    expect(newlyCompleteSpeakableParts(partial, 0).newParts).toEqual(['Stay with me.']);
    const more = `${partial} if you can.`;
    expect(newlyCompleteSpeakableParts(more, 1).newParts).toEqual(['Feet on the floor if you can.']);
  });

  it('unqueuedSpeakableParts includes trailing fragment at end', () => {
    const full = 'First sentence. Second without end';
    expect(unqueuedSpeakableParts(full, 1)).toEqual(['Second without end']);
  });

  it('tailSpeakablePartsAfterQueue does not repeat already-queued complete sentences', () => {
    const full =
      'One. Two. Three. Four. Five. It might help shift some of that weight, even just a little.';
    const completeCount = 6;
    expect(tailSpeakablePartsAfterQueue(full, completeCount)).toEqual([]);
  });

  it('tailSpeakablePartsAfterQueue returns only new complete plus trailing fragment', () => {
    const full = 'Alpha. Beta. Gamma without end';
    expect(tailSpeakablePartsAfterQueue(full, 2)).toEqual(['Gamma without end']);
  });
});
