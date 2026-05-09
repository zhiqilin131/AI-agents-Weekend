import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DecisionReport } from '../../model';
import { RESOURCE_DROP_CALENDAR_ID } from '../../model';
import { RecommendationCard } from './RecommendationCard';

function makeReport(over: Partial<DecisionReport> = {}): DecisionReport {
  const longReason = `${'A substantial reasoning paragraph. '.repeat(25)}Final sentence.`;
  return {
    situation: 'Test',
    insights: { biasRisks: ['confirmation'] },
    options: [
      {
        id: 'opt1',
        name: 'Option One',
        description: 'd',
        keyAssumptions: [],
        costOfReversal: 'low',
      },
    ],
    recommendation: {
      reasoning: longReason,
      chosenOption: 'opt1',
      chosenOptionName: 'Option One',
    },
    actions: [{ text: 'Ship the prototype', deadline: 'Friday' }],
    reflection: {},
    ...over,
  };
}

describe('RecommendationCard', () => {
  it('renders slime advisor and speech bubble', () => {
    const html = renderToStaticMarkup(<RecommendationCard report={makeReport()} />);
    expect(html).toContain('data-testid="slime-advisor"');
    expect(html).toContain('Best current path');
  });

  it('passes cautious slime state when bias risks exist', () => {
    const html = renderToStaticMarkup(<RecommendationCard report={makeReport()} />);
    expect(html).toContain('data-slime-state="cautious"');
  });

  it('renders show full reasoning for long body', () => {
    const html = renderToStaticMarkup(<RecommendationCard report={makeReport()} />);
    expect(html).toContain('Show full reasoning');
  });

  it('renders execution calendar control when executionCalendar is set', () => {
    const navigate = vi.fn();
    const html = renderToStaticMarkup(
      <RecommendationCard
        report={makeReport()}
        executionCalendar={{ decisionId: 'dec-1', navigate, onExecutionCalendarNavigate: vi.fn() }}
      />,
    );
    expect(html).toContain('data-testid="create-execution-calendar"');
    expect(html).toContain('Ship the prototype');
  });

  it('does not duplicate calendar CTA when calendar chip is in resource drops', () => {
    const navigate = vi.fn();
    const html = renderToStaticMarkup(
      <RecommendationCard
        report={makeReport()}
        executionCalendar={{ decisionId: 'dec-1', navigate }}
        resourceDropsLoading={false}
        resourceDrops={[
          {
            id: RESOURCE_DROP_CALENDAR_ID,
            title: 'Create Execution Calendar',
            description: '',
            url: null,
            action_type: 'calendar',
            source: 'internal',
            relevance_reason: '',
            confidence: 1,
            domain: null,
          },
        ]}
      />,
    );
    expect(html).not.toContain('data-testid="create-execution-calendar"');
    expect(html).toContain('resource-chip-calendar');
  });
});
