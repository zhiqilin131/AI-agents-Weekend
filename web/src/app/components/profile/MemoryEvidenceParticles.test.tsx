import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryEvidenceChip } from './MemoryEvidenceChip';

describe('Memory evidence UI', () => {
  it('MemoryEvidenceChip stays small (particle, not a huge memory panel)', () => {
    const html = renderToStaticMarkup(
      <MemoryEvidenceChip
        item={{
          id: '1',
          type: 'profile',
          label: 'Profile clue',
          shortText: 'Short snippet',
          fullText: 'Long text hidden in drawer',
        }}
      />,
    );
    expect(html).toContain('Profile clue');
    expect(html).toContain('Short snippet');
    expect(html).not.toContain('Long text hidden');
    expect(html.length).toBeLessThan(2500);
  });
});
