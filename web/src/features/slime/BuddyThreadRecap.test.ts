import { describe, expect, it } from 'vitest';
import { recapLines } from './BuddyThreadRecap';
import type { ShadowMessage } from '../../app/components/shadow/types';

describe('recapLines', () => {
  it('keeps last user and assistant messages in order', () => {
    const messages: ShadowMessage[] = [
      { id: '1', role: 'user', content: 'First question' },
      { id: '2', role: 'assistant', content: 'First answer' },
      { id: '3', role: 'user', content: 'Follow up' },
      { id: '4', role: 'assistant', content: 'Second answer' },
      { id: '5', role: 'system', content: 'ignored' },
    ];
    const lines = recapLines(messages, 4);
    expect(lines).toHaveLength(4);
    expect(lines[0].role).toBe('user');
    expect(lines[0].text).toContain('First question');
    expect(lines[3].text).toContain('Second answer');
  });

  it('ellipsizes very long content', () => {
    const long = 'x'.repeat(200);
    const lines = recapLines([{ id: '1', role: 'user', content: long }], 1);
    expect(lines[0].text.length).toBeLessThanOrEqual(120);
    expect(lines[0].text.endsWith('…')).toBe(true);
  });
});
