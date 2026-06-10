/** Frontend types/helpers for feature audit in traces. */

export interface ScoringClarifyQuestion {
  id: string;
  feature_key: string;
  option_id?: string | null;
  prompt: string;
  answer_type?: 'level' | 'yes_no' | 'free_text' | 'rank';
  choices?: string[];
  voi_score?: number;
  option_labels?: Record<string, string>;
}

export interface AlignmentViolation {
  type: string;
  option_id?: string;
  feature_key?: string;
  severity?: 'blocker' | 'warning';
  message?: string;
}

export interface AlignmentReport {
  cross_option_discrimination?: number;
  constraint_violations?: AlignmentViolation[];
  near_duplicate_options?: boolean;
  clarity_test_passed?: boolean;
  reconcile_required?: boolean;
  coverage?: number;
  needs_comparative_elicitation?: boolean;
}

export interface TagQualityReport {
  option_id: string;
  coverage_tagged?: number;
  text_conflicts?: string[];
  evidence_support_count?: number;
  passes_quality_gate?: boolean;
}

export interface TagQualityNotice {
  optionId: string;
  conflicts: string[];
  gateFailed: boolean;
}

export interface FeatureVectorRow {
  option_id?: string;
  field_status?: Record<string, string>;
  [key: string]: unknown;
}

export interface FeatureAudit {
  feature_vectors?: FeatureVectorRow[];
  reliability_reports?: Array<Record<string, unknown>>;
  candidates?: Array<Record<string, unknown>>;
  missing_fields?: string[];
  clarify_questions?: ScoringClarifyQuestion[];
  comparative_questions?: ScoringClarifyQuestion[];
  grounded_feature_coverage?: number;
  cross_option_discrimination?: number;
  needs_scoring_clarification?: boolean;
  tag_quality_reports?: TagQualityReport[];
  voi_question_order?: string[];
  alignment_report?: AlignmentReport | null;
}

export interface ElicitationRound {
  round_id?: string;
  timestamp?: string;
  comparative_answers?: Record<string, string[]>;
  scoring_clarification?: Record<string, string>;
  coverage_before?: number;
  coverage_after?: number;
  discrimination_after?: number;
  source?: 'gate' | 'refine' | 'rescore';
}

export type ElicitationSubmitPayload = {
  scoring_clarification: Record<string, string>;
  comparative_answers: Record<string, string[]>;
};

const CONFLICT_LABELS: Record<string, string> = {
  stress_load_level: 'Stress',
  workload_level: 'Workload',
  money_cost_level: 'Cost',
  time_cost_level: 'Time',
  upside_potential_level: 'Upside',
  downside_severity_level: 'Downside',
  goal_alignment_level: 'Goal fit',
};

const MATRIX_KEYS = [
  'time_cost_level',
  'money_cost_level',
  'stress_load_level',
  'workload_level',
  'upside_potential_level',
  'downside_severity_level',
  'goal_alignment_level',
  'reversibility_level',
] as const;

export const MATRIX_KEY_LABELS: Record<string, string> = {
  time_cost_level: 'Time',
  money_cost_level: 'Money',
  stress_load_level: 'Stress',
  workload_level: 'Workload',
  upside_potential_level: 'Upside',
  downside_severity_level: 'Downside',
  goal_alignment_level: 'Goal',
  reversibility_level: 'Reversibility',
};

export function humanizeTagConflict(raw: string): string {
  const match = /^(\w+)=([a-z]+) conflicts with (.+)$/.exec(raw.trim());
  if (!match) return raw;
  const [, key, level, tail] = match;
  const label = CONFLICT_LABELS[key] ?? key.replace(/_level$/, '').replace(/_/g, ' ');
  const detail = tail.replace(/\s+in option text$/, '').replace(/-/g, ' ');
  return `${label} tagged ${level} · ${detail}`;
}

export function tagQualityNotices(audit: FeatureAudit | null | undefined): TagQualityNotice[] {
  if (!audit?.tag_quality_reports?.length) return [];
  const notices: TagQualityNotice[] = [];
  for (const report of audit.tag_quality_reports) {
    const conflicts = (report.text_conflicts ?? [])
      .map((c) => humanizeTagConflict(String(c)))
      .filter(Boolean);
    const gateFailed = report.passes_quality_gate === false;
    if (conflicts.length === 0 && !gateFailed) continue;
    notices.push({
      optionId: String(report.option_id ?? ''),
      conflicts,
      gateFailed: gateFailed && conflicts.length === 0,
    });
  }
  return notices;
}

export function parseFeatureAudit(trace: Record<string, unknown> | null | undefined): FeatureAudit | null {
  if (!trace) return null;
  const raw = trace.feature_audit;
  if (!raw || typeof raw !== 'object') return null;
  return raw as FeatureAudit;
}

export function featureMatrixKeys(): readonly string[] {
  return MATRIX_KEYS;
}

export function statusBadgeClass(status: string): string {
  if (status === 'known') return 'bg-emerald-50/90 text-emerald-700 ring-emerald-200/60';
  if (status === 'candidate') return 'bg-amber-50/80 text-amber-800/90 ring-amber-200/50';
  return 'bg-slate-50 text-slate-500 ring-slate-200/60';
}

export function coverageBadgeClass(coverage: number): string {
  if (coverage >= 0.75) return 'bg-emerald-50/90 text-emerald-700 ring-emerald-200/50';
  if (coverage >= 0.55) return 'bg-amber-50/90 text-amber-800/90 ring-amber-200/40';
  return 'bg-rose-50/80 text-rose-700/90 ring-rose-200/40';
}

export function discriminationLabel(disc: number | undefined): string {
  if (typeof disc !== 'number') return '';
  if (disc >= 0.5) return 'Options are well differentiated';
  if (disc >= 0.25) return 'Moderate differentiation';
  return 'Options look similar — rank or answer tradeoffs below';
}

export function parseElicitationRounds(
  trace: Record<string, unknown> | null | undefined,
): ElicitationRound[] {
  if (!trace) return [];
  const raw = trace.scoring_elicitation_rounds;
  if (!Array.isArray(raw)) return [];
  return raw as ElicitationRound[];
}

/** Prefill clarify panel from prior trace answers (gate resume or refine). */
export function prefillElicitationAnswers(trace: Record<string, unknown> | null | undefined): {
  levelAnswers: Record<string, string>;
  rankAnswers: Record<string, string[]>;
} {
  const levelAnswers: Record<string, string> = {};
  const rankAnswers: Record<string, string[]> = {};
  if (!trace) return { levelAnswers, rankAnswers };
  const levels = trace.scoring_clarification;
  if (levels && typeof levels === 'object') {
    for (const [k, v] of Object.entries(levels as Record<string, string>)) {
      if (typeof v === 'string' && v) levelAnswers[k] = v;
    }
  }
  const cmp = trace.comparative_answers;
  if (cmp && typeof cmp === 'object') {
    for (const [k, v] of Object.entries(cmp as Record<string, string[]>)) {
      if (Array.isArray(v) && v.length) rankAnswers[k] = [...v];
    }
  }
  return { levelAnswers, rankAnswers };
}
