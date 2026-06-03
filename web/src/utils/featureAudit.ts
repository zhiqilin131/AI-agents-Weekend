/** Frontend types/helpers for feature audit in traces. */

export interface ScoringClarifyQuestion {
  id: string;
  feature_key: string;
  option_id?: string | null;
  prompt: string;
  answer_type?: string;
  choices?: string[];
  /** Backend VoI rank; used for ordering only — not shown in UI. */
  voi_score?: number;
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
  /** True when tags failed the quality gate without explicit text conflicts. */
  gateFailed: boolean;
}

export interface FeatureAudit {
  feature_vectors?: Array<Record<string, unknown>>;
  reliability_reports?: Array<Record<string, unknown>>;
  candidates?: Array<Record<string, unknown>>;
  missing_fields?: string[];
  clarify_questions?: ScoringClarifyQuestion[];
  grounded_feature_coverage?: number;
  needs_scoring_clarification?: boolean;
  tag_quality_reports?: TagQualityReport[];
  voi_question_order?: string[];
}

const CONFLICT_LABELS: Record<string, string> = {
  stress_load_level: 'Stress',
  workload_level: 'Workload',
  money_cost_level: 'Cost',
  time_cost_level: 'Time',
  upside_potential_level: 'Upside',
  downside_severity_level: 'Downside',
  goal_alignment_level: 'Goal fit',
};

/** Short, human-readable line for a backend conflict string. */
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
