import { describe, expect, it } from 'vitest';
import { inferUtteranceLang } from './useSpeechSynthesis';

describe('inferUtteranceLang', () => {
  it('uses en-US for English decision report style text', () => {
    expect(inferUtteranceLang('Staying at CMU aligns with your goals.')).toBe('en-US');
  });

  it('uses zh when Han characters dominate', () => {
    expect(inferUtteranceLang('你好，今天我们要讨论职业选择。')).toBe('zh-CN');
  });

  it('uses en-US for short mixed greeting with mostly Latin', () => {
    expect(inferUtteranceLang("Hey, what's up? 嗨")).toBe('en-US');
  });
});
