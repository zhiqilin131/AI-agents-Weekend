import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScoringClarifyPanel } from './ScoringClarifyPanel';

describe('ScoringClarifyPanel', () => {
  it('marks the first level question as highest impact without showing voi_score', () => {
    const html = renderToStaticMarkup(
      <ScoringClarifyPanel
        variant="gate"
        coverage={0.4}
        discrimination={0.1}
        levelQuestions={[
          { id: 'q1', feature_key: 'stress_load_level', prompt: 'How stressful is option A?', voi_score: 0.91 },
          { id: 'q2', feature_key: 'money_cost_level', prompt: 'Cost level?', voi_score: 0.2 },
        ]}
        comparativeQuestions={[]}
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

  it('shows comparative rank step when comparative questions exist', () => {
    const html = renderToStaticMarkup(
      <ScoringClarifyPanel
        variant="gate"
        coverage={0.2}
        levelQuestions={[]}
        comparativeQuestions={[
          {
            id: 'cmp:time_cost_level:rank',
            feature_key: 'time_cost_level',
            prompt: 'Rank by time',
            answer_type: 'rank',
            choices: ['a', 'b'],
            option_labels: { a: 'Alpha', b: 'Beta' },
          },
        ]}
        onApply={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(html).toContain('Compare options');
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
  });
});
