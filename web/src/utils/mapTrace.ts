/**
 * Map backend `DecisionTrace` JSON (from `/api/run`) to UI `DecisionReport`.
 * Tolerates partial payloads during SSE streaming.
 */
import type { DecisionReport } from '../app/model';

interface TraceUserState {
  raw_input?: string;
  decision_type?: string;
  time_pressure?: string;
  stress_level?: number;
  workload?: number;
}

interface TraceOption {
  option_id: string;
  name: string;
  description: string;
  key_assumptions: string[];
  cost_of_reversal: string;
}

interface TraceEvaluation {
  option_id: string;
  expected_value_score: number;
  risk_score: number;
  regret_score: number;
  uncertainty_score: number;
  goal_alignment_score: number;
}

/**
 * Must match ``composite_score`` + ``DEFAULT_EVALUATION_WEIGHTS`` in
 * ``foresight_x/decision/recommender.py`` so option sort / tier labels align with the chosen recommendation.
 */
function compositeImportance(ev: TraceEvaluation | undefined): number {
  if (!ev) return -Infinity;
  return (
    0.25 * ev.expected_value_score +
    -0.15 * ev.risk_score +
    -0.15 * ev.regret_score +
    -0.15 * ev.uncertainty_score +
    0.25 * ev.goal_alignment_score
  );
}

function tierForRank(rank: number, total: number): 'high' | 'medium' | 'low' {
  if (total <= 1) return 'high';
  const t = (rank - 1) / total;
  if (t < 1 / 3) return 'high';
  if (t < 2 / 3) return 'medium';
  return 'low';
}

interface TraceRecommendation {
  chosen_option_id?: string;
  reasoning?: string;
  next_actions?: Array<{ action: string; deadline?: string | null }>;
}

interface TraceReflection {
  possible_errors?: string[];
  uncertainty_sources?: string[];
  information_gaps?: string[];
  self_improvement_signal?: string;
}

interface TraceRationality {
  detected_biases?: string[];
}

interface TraceMemory {
  behavioral_patterns?: string[];
}

const TRADE_HINTS: Record<string, string> = {
  EV: 'Expected upside vs baseline (0–10)',
  Risk: 'Downside / variance (higher = riskier)',
  Regret: 'Pain if this choice is wrong',
  Uncertainty: 'Forecast confidence (higher = less sure)',
  GoalAlign: 'Fit to your stated goals + profile',
};

export function mapTraceToReport(trace: Record<string, unknown>): DecisionReport {
  const us = trace.user_state as TraceUserState | undefined;
  const rationality = trace.rationality as TraceRationality | undefined;
  const memory = trace.memory as TraceMemory | undefined;
  const evaluations = (trace.evaluations as TraceEvaluation[]) ?? [];
  const options = (trace.options as TraceOption[]) ?? [];
  const rec = trace.recommendation as TraceRecommendation | undefined;
  const refl = trace.reflection as TraceReflection | undefined;

  const orig =
    typeof trace.original_user_input === 'string' ? trace.original_user_input : '';
  const preview =
    typeof trace.enhanced_preview === 'string' ? trace.enhanced_preview : '';
  const situation = us?.raw_input ?? preview ?? '';

  const evalById = new Map(evaluations.map((e) => [e.option_id, e]));

  const chosenId = typeof rec?.chosen_option_id === 'string' ? rec.chosen_option_id.trim() : '';
  const chosenName =
    chosenId && options.length
      ? options.find((o) => o.option_id === chosenId)?.name?.trim() || chosenId
      : chosenId;

  const sortedForImportance = [...options].sort((a, b) => {
    const ca = compositeImportance(evalById.get(a.option_id));
    const cb = compositeImportance(evalById.get(b.option_id));
    return cb - ca;
  });
  const rankByOptionId = new Map(sortedForImportance.map((o, i) => [o.option_id, i + 1]));
  const optionCount = sortedForImportance.length;

  const rows = sortedForImportance.map((opt) => {
    const ev = evalById.get(opt.option_id);
    return {
      optionId: opt.option_id,
      optionName: opt.name,
      scores: ev
        ? {
            EV: Number(ev.expected_value_score.toFixed(1)),
            Risk: Number(ev.risk_score.toFixed(1)),
            Regret: Number(ev.regret_score.toFixed(1)),
            Uncertainty: Number(ev.uncertainty_score.toFixed(1)),
            GoalAlign: Number(ev.goal_alignment_score.toFixed(1)),
          }
        : {},
    };
  });

  const hasScores = rows.length > 0 && rows.some((r) => Object.keys(r.scores).length > 0);
  const headers = ['EV', 'Risk', 'Regret', 'Uncertainty', 'GoalAlign'] as const;
  const headerHints: Record<string, string> = {};
  for (const h of headers) {
    headerHints[h] = TRADE_HINTS[h] ?? '';
  }

  const enhancedForCompare = situation;
  const showEnhanced =
    orig.length > 0 && enhancedForCompare.length > 0 && orig.trim() !== enhancedForCompare.trim();

  return {
    originalInput: orig || undefined,
    enhancedInput: showEnhanced ? enhancedForCompare : undefined,
    situation,
    insights: {
      decisionType: us?.decision_type,
      timePressure: us?.time_pressure,
      stress:
        us?.stress_level !== undefined && us?.workload !== undefined
          ? `${us.stress_level}/10, ${us.workload}/10`
          : undefined,
      biasRisks:
        rationality?.detected_biases && rationality.detected_biases.length
          ? rationality.detected_biases
          : undefined,
      memoryPatterns: memory?.behavioral_patterns?.slice(0, 3),
    },
    options: sortedForImportance.map((o) => {
      const rank = rankByOptionId.get(o.option_id) ?? 1;
      return {
        id: o.option_id,
        name: o.name,
        description: o.description,
        keyAssumptions: Array.isArray(o.key_assumptions) ? o.key_assumptions : [],
        costOfReversal: o.cost_of_reversal ?? '—',
        importanceRank: rank,
        importanceTier: tierForRank(rank, optionCount),
        isRecommended: Boolean(chosenId && o.option_id === chosenId),
      };
    }),
    tradeoffs: hasScores
      ? {
          headers: [...headers],
          headerHints,
          rows,
        }
      : undefined,
    recommendation: {
      reasoning: rec?.reasoning ?? '',
      chosenOption: rec?.chosen_option_id ?? '',
      chosenOptionName: chosenName || undefined,
    },
    actions: (rec?.next_actions ?? []).map((a) => ({
      text: a.action,
      deadline: a.deadline ?? undefined,
    })),
    reflection: {
      possibleErrors: refl?.possible_errors?.slice(0, 10),
      uncertaintySources: refl?.uncertainty_sources?.slice(0, 10),
      informationGaps: refl?.information_gaps?.slice(0, 10),
      selfImprovement: refl?.self_improvement_signal,
    },
  };
}
