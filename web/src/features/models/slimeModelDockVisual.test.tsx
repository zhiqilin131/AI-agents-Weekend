import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getSlimeModelDockVisual, SlimeModelDockTierGlyph } from './slimeModelDockVisual';

describe('slimeModelDockVisual', () => {
  it('assigns a distinct icon per known tier', () => {
    expect(getSlimeModelDockVisual('little', 'Little Slime').iconId).toBe('coins');
    expect(getSlimeModelDockVisual('swift', 'Swift Slime').iconId).toBe('wind');
    expect(getSlimeModelDockVisual('balanced', 'Balanced Slime').iconId).toBe('sliders');
    expect(getSlimeModelDockVisual('deep', 'Deep Slime').iconId).toBe('brain');
    expect(getSlimeModelDockVisual('slime_55', '5.5').iconId).toBe('star');
    expect(getSlimeModelDockVisual('research', 'Research Slime').iconId).toBe('microscope');
  });

  it('renders gem icon, abbrev, and model-picker badge on dock trigger', () => {
    const html = renderToStaticMarkup(
      <SlimeModelDockTierGlyph modelId="little" displayName="Little Slime" size="dock" />,
    );
    expect(html).toContain('LIT');
    expect(html).toContain('lucide-coins');
    expect(html).not.toContain('lucide-layout-grid');
  });
});
