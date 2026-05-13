import { describe, expect, it } from 'vitest';
import { deriveReportSurfaceFromTrace, parseReportSurface } from './reportSurfaceFromTrace';

describe('reportSurfaceFromTrace', () => {
  it('parses backend report_surface snake_case', () => {
    const raw = {
      grounding_note: 'Based mostly on current context, not past behavior.',
      grounding_strength: 'thin',
      grounding_signals: [
        { type: 'user_context', label: 'User context', text: 'Hello', strength: 'strong' },
      ],
      personalized_reasons: [{ text: 'Because you prefer stability.', based_on: [{ type: 'profile', text: 'Stability' }] }],
      future_paths: [
        {
          path_type: 'expected',
          title: 'Expected Path',
          summary: 'Steady progress.',
          trigger_conditions: ['When schedule holds'],
          watch_signals: ['Fatigue'],
          recommended_action: 'Keep going.',
          based_on: [{ type: 'user_statement', text: 'Hello' }],
        },
        {
          path_type: 'friction',
          title: 'Friction Path',
          summary: 'Bumps.',
          trigger_conditions: ['When overload'],
          watch_signals: ['Missed deadlines'],
          recommended_action: 'Slow down.',
          based_on: [{ type: 'memory', text: 'Pattern' }],
        },
        {
          path_type: 'pivot',
          title: 'Pivot Path',
          summary: 'Shift.',
          trigger_conditions: ['When opportunity'],
          watch_signals: ['New info'],
          recommended_action: 'Revisit.',
          based_on: [{ type: 'current_constraint', text: 'Time' }],
        },
      ],
      key_assumptions: ['A1'],
      primary_next_action: { text: 'Do X', duration_estimate: '20 min', deadline: null },
    };
    const s = parseReportSurface(raw);
    expect(s?.groundingNote).toContain('past behavior');
    expect(s?.groundingStrength).toBe('thin');
    expect(s?.groundingSignals[0]?.label).toBe('User context');
    expect(s?.futurePaths).toHaveLength(3);
    expect(s?.primaryNextAction.text).toBe('Do X');
  });

  it('derives three paths from minimal trace', () => {
    const trace = {
      recommendation: {
        chosen_option_id: 'o1',
        reasoning: 'Pick o1',
        next_actions: [{ action: 'Send email', deadline: 'Tomorrow' }],
      },
      user_state: {
        raw_input: 'Should I switch jobs?',
        profile_constraints: [],
        profile_priorities: [],
        profile_memory_facts: [],
      },
      memory: {
        similar_past_decisions: [],
        behavioral_patterns: [],
        memory_evidence: [],
        prior_outcomes_summary: '',
      },
      options: [{ option_id: 'o1', name: 'Stay', key_assumptions: ['Boss stays supportive'] }],
      futures: [
        {
          option_id: 'o1',
          time_horizon: '3 months',
          scenarios: [
            { label: 'base', trajectory: 'Baseline path', probability: 0.5, key_drivers: ['time'] },
            { label: 'worst', trajectory: 'Hard path', probability: 0.25, key_drivers: ['risk'] },
            { label: 'best', trajectory: 'Good path', probability: 0.25, key_drivers: ['luck'] },
          ],
        },
      ],
      evaluations: [{ option_id: 'o1', rationale: 'Solid EV.' }],
      reflection: {
        uncertainty_sources: ['Market'],
        information_gaps: [],
        possible_errors: [],
      },
    };
    const s = deriveReportSurfaceFromTrace(trace);
    expect(s).not.toBeNull();
    expect(s!.groundingStrength).toBe('thin');
    expect(s!.groundingSignals.map((x) => x.type)).toContain('external_evidence');
    expect(s!.futurePaths.map((p) => p.pathType).sort()).toEqual(['expected', 'friction', 'pivot']);
    expect(s!.primaryNextAction.durationEstimate).toContain('Target');
  });
});
