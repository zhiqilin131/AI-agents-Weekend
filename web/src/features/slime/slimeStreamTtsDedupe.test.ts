import { describe, expect, it } from 'vitest';
import {
  chunkPendingInQueue,
  markPlayedSpeakParts,
  markQueuedSpeakParts,
  newlyCompleteSpeakableParts,
  orderedSpeakableParts,
  speakPartDedupeKey,
  streamRemainingSpeakParts,
} from './slimeTtsChunks';

/** Mirrors stream enqueue: one TTS chunk per complete sentence, no grouping. */
function simulateStreamEnqueue(fullText: string) {
  const playedKeys = new Set<string>();
  const queuedKeys = new Set<string>();
  const orderedQueue: string[] = [];
  let queuedCompleteCount = 0;

  const feed = (text: string) => {
    const { newParts, completeCount } = newlyCompleteSpeakableParts(text, queuedCompleteCount);
    queuedCompleteCount = completeCount;
    for (const part of newParts) {
      if (queuedKeys.has(part.toLowerCase().replace(/\s+/g, ' ').trim())) continue;
      markQueuedSpeakParts(part, queuedKeys);
      orderedQueue.push(part);
    }
  };

  const playAll = () => {
    for (const chunk of orderedQueue) {
      markPlayedSpeakParts(chunk, playedKeys);
    }
  };

  return { feed, playAll, playedKeys, queuedKeys, orderedQueue, get queuedCompleteCount() {
    return queuedCompleteCount;
  } };
}

describe('stream TTS dedupe (no double read)', () => {
  const SAMPLE =
    "I'm sorry to hear that you're feeling sad right now, Bob. It's okay to feel this way sometimes. Since you value deep connections, maybe reaching out to one of your girlfriends could help lift your mood. Consider sending a quick message to them or planning a small get-together. This might help you feel more connected and supported during this tough moment.";

  it('finish tail is empty when every sentence was streamed and played', () => {
    const sim = simulateStreamEnqueue(SAMPLE);
    for (let i = 8; i <= SAMPLE.length; i += 12) {
      sim.feed(SAMPLE.slice(0, i));
    }
    sim.feed(SAMPLE);
    sim.playAll();

    const tail = streamRemainingSpeakParts(SAMPLE, sim.playedKeys, []);
    expect(tail).toEqual([]);
    expect(orderedSpeakableParts(SAMPLE).length).toBe(sim.orderedQueue.length);
  });

  it('finish tail does not re-enqueue chunks still pending in the play queue', () => {
    const sim = simulateStreamEnqueue(SAMPLE);
    sim.feed(SAMPLE);
    const pending = sim.orderedQueue.slice(1);
    const played = new Set<string>();
    markPlayedSpeakParts(sim.orderedQueue[0], played);

    const tail = streamRemainingSpeakParts(SAMPLE, played, pending);
    expect(tail).toEqual([]);
    for (const chunk of pending) {
      expect(chunkPendingInQueue(chunk, sim.orderedQueue)).toBe(true);
    }
  });

  it('finish pass uses stream canon only (API reworded text is not fed to TTS)', () => {
    const streamCanon =
      "I'm sorry to hear that you're feeling sick, Bob. It's important to take care of yourself during this time. Make sure to rest and stay hydrated. A good next step is to reach out to someone for support.";
    const played = new Set<string>();
    for (const part of orderedSpeakableParts(streamCanon)) {
      played.add(speakPartDedupeKey(part));
    }
    expect(streamRemainingSpeakParts(streamCanon, played, [])).toEqual([]);
  });

  it('incremental stream feed never queues the same sentence twice', () => {
    const sim = simulateStreamEnqueue(SAMPLE);
    for (let i = 8; i <= SAMPLE.length; i += 6) {
      sim.feed(SAMPLE.slice(0, i));
    }
    sim.feed(SAMPLE);
    const parts = orderedSpeakableParts(SAMPLE);
    expect(sim.orderedQueue.length).toBe(parts.length);
    const keys = sim.orderedQueue.map((p) => p.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });
});
