import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelSelector } from './ModelSelector';
import type { SlimeModelRow } from './types';

vi.mock('./slimeModelsApi', () => ({
  fetchCostPreview: vi.fn().mockResolvedValue({
    feature: 'shadow_chat',
    model_id: 'swift',
    base_cost: 1,
    model_multiplier: 1,
    final_cost: 1,
    balance: 5,
    allowed: true,
  }),
}));

const sampleModels: SlimeModelRow[] = [
  {
    id: 'swift',
    display_name: 'Swift Slime',
    description: 'Fast',
    best_for: ['Chat'],
    tier: 'cheap',
    speed: 'fast',
    quality: 'good',
    credit_multiplier: 1,
    enabled: true,
    engine: 'gpt-4.1-nano',
  },
  {
    id: 'deep',
    display_name: 'Deep Slime',
    description: 'Slow',
    best_for: ['Reports'],
    tier: 'premium',
    speed: 'slow',
    quality: 'highest',
    credit_multiplier: 5,
    enabled: true,
    engine: 'gpt-4.1',
  },
];

describe('ModelSelector', () => {
  it('returns null when selector disabled', () => {
    const html = renderToStaticMarkup(
      <ModelSelector
        feature="shadow_chat"
        selectedModelId="swift"
        onChange={() => {}}
        models={sampleModels}
        selectorEnabled={false}
      />,
    );
    expect(html).toBe('');
  });

  it('renders compact select when enabled', () => {
    const html = renderToStaticMarkup(
      <ModelSelector
        feature="shadow_chat"
        selectedModelId="swift"
        onChange={() => {}}
        models={sampleModels}
        selectorEnabled
        showCostPreview={false}
        elevated={false}
      />,
    );
    expect(html).toContain('Swift Slime');
    expect(html).toContain('Slime model');
  });

  it('compact mode can hide header row', () => {
    const html = renderToStaticMarkup(
      <ModelSelector
        feature="shadow_chat"
        selectedModelId="swift"
        onChange={() => {}}
        models={sampleModels}
        selectorEnabled
        variant="compact"
        elevated={false}
        hideCompactHeader
        compactSelectAriaLabel="Model tier"
        showCostPreview={false}
      />,
    );
    expect(html).toContain('Swift Slime');
    expect(html).toContain('aria-label="Model tier"');
    expect(html).not.toContain('lucide-sparkles');
  });

  it('renders engine on cards variant', () => {
    const html = renderToStaticMarkup(
      <ModelSelector
        feature="shadow_chat"
        selectedModelId="swift"
        onChange={() => {}}
        models={sampleModels}
        selectorEnabled
        variant="cards"
        hint=""
        showCostPreview={false}
        elevated={false}
      />,
    );
    expect(html).toContain('gpt-4.1-nano');
    expect(html).toContain('gpt-4.1');
  });
});
