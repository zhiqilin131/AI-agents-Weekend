import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScoringClarifyPanel } from './ScoringClarifyPanel';

describe('ScoringClarifyPanel', () => {
  it('marks the first question as highest impact without showing voi_score', () => {
    const html = renderToStaticMarkup(
      <ScoringClarifyPanel
        variant="gate"
        coverage={0.4}
        questions={[
          { id: 'q1', feature_key: 'stress_load_level', prompt: 'How stressful is option A?', voi_score: 0.91 },
          { id: 'q2', feature_key: 'money_cost_level', prompt: 'Cost level?', voi_score: 0.2 },
        ]}
        onApply={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(html).toContain('data-variant="gate"');
    expect(html).toContain('Most likely to shift ranking');
    expect(html).toContain('How stressful is option A?');
    expect(html).toContain('Use provisional ranking');
    expect(html).not.toContain('0.91');
  });
});
