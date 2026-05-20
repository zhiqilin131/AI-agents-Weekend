import { describe, expect, it } from 'vitest';
import {
  StreamTtsLedger,
  appendToSpokenPrefix,
  isChunkAlreadySpoken,
  normalizeSpeakKey,
} from './slimeStreamTtsLedger';

describe('slimeStreamTtsLedger', () => {
  it('normalizeSpeakKey collapses apostrophe variants', () => {
    const a = normalizeSpeakKey("It's important to take care.");
    const b = normalizeSpeakKey('It\u2019s important to take care.');
    expect(a).toBe(b);
  });

  it('shouldEnqueue rejects duplicate sentence keys', () => {
    const ledger = new StreamTtsLedger();
    expect(ledger.enqueue('Hello world.')).toBe(0);
    expect(ledger.enqueue('Hello world.')).toBeNull();
  });

  it('shouldEnqueue rejects text already in spokenPrefix', () => {
    const ledger = new StreamTtsLedger();
    ledger.enqueue('First sentence here.');
    ledger.markPlaying();
    ledger.markDone('First sentence here.');
    expect(ledger.shouldEnqueue('First sentence here.')).toBe(false);
    expect(ledger.enqueue('First sentence here.')).toBeNull();
  });

  it('isChunkAlreadySpoken catches substring overlap', () => {
    const spoken = "I'm sorry to hear that you're feeling sick, Bob.";
    const next = "I'm sorry to hear that you're feeling sick, Bob. It's important.";
    expect(isChunkAlreadySpoken(next, spoken, new Set())).toBe(true);
  });

  it('playCursor only advances on markDone', () => {
    const ledger = new StreamTtsLedger();
    ledger.enqueue('One.');
    ledger.enqueue('Two.');
    ledger.markPlaying();
    ledger.markFailed(99);
    expect(ledger.playCursor).toBe(0);
    ledger.markDone('One.');
    expect(ledger.playCursor).toBe(1);
  });

  it('remainingCanonParts is empty when all parts enqueued and done', () => {
    const canon =
      "I'm sorry to hear that you're feeling sick, Bob. It's important to take care of yourself. Make sure to rest.";
    const ledger = new StreamTtsLedger();
    ledger.feedCompleteCount = 0;
    for (const part of ledger.feedNewParts(canon)) {
      ledger.enqueue(part);
    }
    while (ledger.hasMoreToPlay()) {
      const c = ledger.chunkAtPlayCursor();
      if (!c) break;
      ledger.markPlaying();
      ledger.markDone(c.text);
    }
    expect(ledger.remainingCanonParts(canon)).toEqual([]);
  });

  it('feedNewParts never returns the same sentence twice across incremental feeds', () => {
    const canon = 'Alpha. Beta. Gamma.';
    const ledger = new StreamTtsLedger();
    const first = ledger.feedNewParts('Alpha.');
    expect(first).toEqual(['Alpha.']);
    ledger.enqueue(first[0]!);
    const second = ledger.feedNewParts('Alpha. Beta.');
    expect(second).toEqual(['Beta.']);
    ledger.enqueue(second[0]!);
    const third = ledger.feedNewParts(canon);
    expect(third).toEqual(['Gamma.']);
  });

  it('appendToSpokenPrefix is idempotent for repeated chunks', () => {
    let p = '';
    p = appendToSpokenPrefix(p, 'Hello.');
    p = appendToSpokenPrefix(p, 'Hello.');
    expect(p).toBe('Hello.');
  });
});
