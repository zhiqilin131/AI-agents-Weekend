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

  it('accepts custom slime profile props', () => {
    const html = renderToStaticMarkup(
      <SlimeAdvisor
        profile={{
          name: 'Blob',
          colorTheme: 'mint',
          personality: 'playful',
          shape: 'robot',
          accessory: 'antenna',
          motion: 'expressive',
          updated_at: '',
        }}
      />,
    );
    expect(html).toContain('data-testid="slime-advisor"');
  });

  it('renders spark accessory', () => {
    const html = renderToStaticMarkup(
      <SlimeAdvisor
        profile={{
          name: 'x',
          colorTheme: 'violet',
          personality: 'calm',
          shape: 'classic',
          accessory: 'spark',
          motion: 'normal',
          updated_at: '',
        }}
      />,
    );
    expect(html).toContain('data-testid="slime-advisor"');
  });

  it('differs markup for speaking vs idle mouth motion', () => {
    const idle = renderToStaticMarkup(<SlimeAdvisor state="idle" />);
    const speaking = renderToStaticMarkup(<SlimeAdvisor state="speaking" />);
    expect(idle).toContain('data-testid="slime-mouth"');
    expect(speaking).toContain('data-testid="slime-mouth"');
    expect(idle).not.toEqual(speaking);
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
