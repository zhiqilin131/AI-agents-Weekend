import { describe, expect, it } from 'vitest';
import {
  firstSpeakableChunk,
  firstSpeakableSentence,
  newlyCompleteSpeakableParts,
  remainderAfterSpokenPrefix,
  streamBubbleDisplayText,
  groupSpeakableParts,
  splitSpeakableParts,
  ttsPrefetchMatchesFinal,
  extensionSpeakParts,
  resolveVoiceDisplayText,
  resolveVoiceTurnText,
  tailSpeakablePartsAfterQueue,
  unqueuedSpeakableParts,
  unspokenStreamParts,
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

  it('remainderAfterSpokenPrefix does not replay full text on prefix mismatch', () => {
    const streamed = "I'm really sorry to hear that you're feeling sad right now, Bob.";
    const finalText =
      `${streamed} It's important to acknowledge those feelings. Consider taking a moment to do something you enjoy.`;
    expect(remainderAfterSpokenPrefix(finalText, streamed)).toBe(
      "It's important to acknowledge those feelings. Consider taking a moment to do something you enjoy.",
    );
    expect(remainderAfterSpokenPrefix(finalText, 'Totally different prefix.')).toBe('');
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

  it('resolveVoiceDisplayText extends stream but keeps stream when API diverges', () => {
    const streamed =
      "Let's explore some events you can attend, Bob! Since you're looking for richer connections.";
    const apiFinal =
      "Let's explore events, Bob! Since you want connections, check local meetups for soccer or rap.";
    expect(resolveVoiceDisplayText(streamed, apiFinal)).toBe(streamed);
    expect(resolveVoiceDisplayText(streamed, `${streamed} More at the end.`)).toBe(`${streamed} More at the end.`);
    expect(resolveVoiceTurnText(streamed, apiFinal)).toBe(streamed);
  });

  it('unspokenStreamParts with played keys skips heard sentences only', () => {
    const heard = new Set(['alpha.', 'beta.']);
    const full = 'Alpha. Beta. Gamma.';
    expect(unspokenStreamParts(full, heard)).toEqual(['Gamma.']);
  });

  it('extensionSpeakParts only returns API tail not already played', () => {
    const streamed =
      'It sounds like dinner with Stephen could help. Eating together can recharge.';
    const apiFinal = `${streamed} Consider inviting Stephen over for dinner instead of eating alone.`;
    const played = new Set(['it sounds like dinner with stephen could help.', 'eating together can recharge.']);
    expect(extensionSpeakParts(apiFinal, streamed, played)).toEqual([
      'Consider inviting Stephen over for dinner instead of eating alone.',
    ]);
    expect(extensionSpeakParts(apiFinal, apiFinal, played)).toEqual([]);
  });

  it('streamBubbleDisplayText only includes queued complete sentences', () => {
    const full = 'First sentence. Second sentence. Third without end';
    expect(streamBubbleDisplayText(full, 0)).toBe('');
    expect(streamBubbleDisplayText(full, 1)).toBe('First sentence.');
    expect(streamBubbleDisplayText(full, 2)).toBe('First sentence. Second sentence.');
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

  it('unspokenStreamParts skips keys already played', () => {
    const full = 'Alpha. Beta. Gamma.';
    const played = new Set(['alpha.', 'beta.']);
    expect(unspokenStreamParts(full, played)).toEqual(['Gamma.']);
  });

  it('tailSpeakablePartsAfterQueue returns only new complete plus trailing fragment', () => {
    const full = 'Alpha. Beta. Gamma without end';
    expect(tailSpeakablePartsAfterQueue(full, 2)).toEqual(['Gamma without end']);
  });
});
