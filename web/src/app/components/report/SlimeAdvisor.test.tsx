import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlimeAdvisor } from './SlimeAdvisor';

describe('SlimeAdvisor', () => {
  it('renders idle state by default', () => {
    const html = renderToStaticMarkup(<SlimeAdvisor />);
    expect(html).toContain('data-slime-state="idle"');
  });

  it('applies speaking state only when prop is speaking', () => {
    const idle = renderToStaticMarkup(<SlimeAdvisor state="idle" />);
    const speaking = renderToStaticMarkup(<SlimeAdvisor state="speaking" />);
    expect(idle).toContain('data-slime-state="idle"');
    expect(speaking).toContain('data-slime-state="speaking"');
  });
});

describe('MiniReadAloudControl', () => {
  it('renders nothing when speech synthesis unsupported', async () => {
    const { MiniReadAloudControl } = await import('./MiniReadAloudControl');
    const html = renderToStaticMarkup(
      <MiniReadAloudControl supported={false} isPlaying={false} isPaused={false} onPress={() => {}} />,
    );
    expect(html).toBe('');
  });
});
