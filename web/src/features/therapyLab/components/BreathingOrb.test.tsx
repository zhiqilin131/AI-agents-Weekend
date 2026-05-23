import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BreathingOrb } from './BreathingOrb';

describe('BreathingOrb', () => {
  it('renders countdown on the orb', () => {
    const html = renderToStaticMarkup(
      <BreathingOrb phaseId="inhale" phaseSeconds={4} countdown={3} label="Inhale" />,
    );
    expect(html).toContain('>3<');
    expect(html).toContain('Inhale');
  });
});
