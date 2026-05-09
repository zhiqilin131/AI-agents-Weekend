import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClarificationCard } from './ClarificationCard';

const qs = [
  {
    id: 'summer_objective',
    prompt: 'Optimize for learning, prestige, pay, or calm?',
    options: [
      { value: 'learn', label: 'Learning' },
      { value: 'prestige', label: 'Prestige' },
    ],
  },
];

describe('ClarificationCard', () => {
  it('renders selected question', () => {
    const html = renderToStaticMarkup(
      <ClarificationCard
        questions={qs}
        meta={{ target_dimension: 'summer_objective', why_this_question: 'Because tradeoffs differ.' }}
        onSkip={() => {}}
        onAnswer={() => {}}
      />,
    );
    expect(html).toContain('One thing I need to understand');
    expect(html).toContain(qs[0].prompt);
    expect(html).toContain('Skip');
    expect(html).toContain('Why ask this?');
    expect(html).toContain('Answer');
  });

  it('includes rationale when why panel would be toggled (static markup shows controls only)', () => {
    const html = renderToStaticMarkup(
      <ClarificationCard
        questions={qs}
        meta={{ target_dimension: 'summer_objective', why_this_question: 'Custom rationale text.' }}
        onSkip={() => {}}
        onAnswer={() => {}}
      />,
    );
    expect(html).toContain('Why ask this?');
  });
});
