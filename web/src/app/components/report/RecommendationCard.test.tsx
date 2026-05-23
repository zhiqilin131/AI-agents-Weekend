import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DecisionReport, SlimeProfile } from '../../model';
import { RESOURCE_DROP_CALENDAR_ID } from '../../model';
import { NextActionCard } from './NextActionCard';
import { RecommendationCard } from './RecommendationCard';

const { slimeMock } = vi.hoisted(() => {
  const slimeMock: SlimeProfile = {
    name: 'Mochi',
    colorTheme: 'violet',
    personality: 'calm',
    shape: 'classic',
    accessory: 'none',
    motion: 'normal',
    persona: {
      userNickname: null,
      roleIdentity:
        'A personal decision companion that helps the user think clearly, remember context, and turn decisions into action.',
      personalityPreset: 'calm_advisor',
      tone: 'warm',
      warmth: 2,
      humor: 1,
      directness: 1,
      replyLength: 'balanced',
      catchphrases: [],
      donts: [],
    },
    updated_at: '',
  };
  return { slimeMock };
});

vi.mock('../../../hooks/useSlimeProfile', () => ({
  useSlimeProfile: () => ({
    slimeProfile: slimeMock,
    refreshSlimeProfile: vi.fn(),
  }),
}));

afterEach(() => {
  slimeMock.name = 'Mochi';
  slimeMock.personality = 'calm';
  slimeMock.persona = {
    userNickname: null,
    roleIdentity:
      'A personal decision companion that helps the user think clearly, remember context, and turn decisions into action.',
    personalityPreset: 'calm_advisor',
    tone: 'warm',
    warmth: 2,
    humor: 1,
    directness: 1,
    replyLength: 'balanced',
    catchphrases: [],
    donts: [],
  };
});

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
    expect(html).toContain('Mochi');
    expect(html).toContain('suggestion');
  });

  it('uses possessive suggestion label for slime name', () => {
    slimeMock.name = 'Ron';
    slimeMock.personality = 'calm';
    if (slimeMock.persona) slimeMock.persona.tone = 'analytical';
    const html = renderToStaticMarkup(<RecommendationCard report={makeReport()} />);
    expect(html).toContain('Ron');
    expect(html).toContain('suggestion');
  });

  it('passes cautious slime state when bias risks exist', () => {
    const html = renderToStaticMarkup(<RecommendationCard report={makeReport()} />);
    expect(html).toContain('data-slime-state="cautious"');
  });

  it('renders show full reasoning for long body', () => {
    const html = renderToStaticMarkup(<RecommendationCard report={makeReport()} />);
    expect(html).toContain('Show full reasoning');
  });

  it('keeps calendar planning out of the recommendation card to avoid duplicate CTAs', () => {
    const navigate = vi.fn();
    const html = renderToStaticMarkup(
      <RecommendationCard
        report={makeReport()}
        executionCalendar={{ decisionId: 'dec-1', navigate, onExecutionCalendarNavigate: vi.fn() }}
      />,
    );
    expect(html).not.toContain('data-testid="create-execution-calendar"');
    expect(html).not.toContain('Plan these steps on calendar');
  });

  it('renders the single calendar planning CTA in the next-steps card', () => {
    const html = renderToStaticMarkup(
      <NextActionCard
        actions={[{ text: 'Ship the prototype', deadline: 'Friday' }]}
        decisionId="dec-1"
        navigate={vi.fn()}
      />,
    );
    expect(html).toContain('data-testid="plan-next-steps-calendar"');
    expect(html).toContain('Plan these steps on calendar');
    expect(html).toContain('Creates draft blocks');
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
