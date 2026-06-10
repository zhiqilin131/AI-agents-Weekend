import type { ElicitationSubmitPayload, FeatureAudit, ScoringClarifyQuestion } from '../../../utils/featureAudit';

export type ScoringClarifyPending = {
  decisionId: string;
  levelQuestions: ScoringClarifyQuestion[];
  comparativeQuestions: ScoringClarifyQuestion[];
  coverage?: number;
  discrimination?: number;
  audit?: FeatureAudit | null;
  optionNames?: Record<string, string>;
  resumePartial: Record<string, unknown>;
  decisionPrompt: string;
  elicitationRound?: number;
  maxElicitationRounds?: number;
  validationErrors?: string[];
};

export function gateFromReportEvent(
  data: Record<string, unknown>,
  decisionPrompt: string,
): ScoringClarifyPending | null {
  const resumePartial =
    data.resume_partial && typeof data.resume_partial === 'object'
      ? (data.resume_partial as Record<string, unknown>)
      : null;
  const levelQuestions = Array.isArray(data.clarify_questions)
    ? (data.clarify_questions as ScoringClarifyQuestion[])
    : [];
  const comparativeQuestions = Array.isArray(data.comparative_questions)
    ? (data.comparative_questions as ScoringClarifyQuestion[])
    : [];
  const decisionId = typeof data.decision_id === 'string' ? data.decision_id : '';
  if (!resumePartial || !decisionId || (!levelQuestions.length && !comparativeQuestions.length)) {
    return null;
  }
  const options = Array.isArray(resumePartial.options)
    ? (resumePartial.options as Array<{ option_id?: string; name?: string }>)
    : [];
  const optionNames: Record<string, string> = {};
  for (const o of options) {
    if (o.option_id) optionNames[o.option_id] = o.name ?? o.option_id;
  }
  const auditFromGate: FeatureAudit = {
    ...(typeof resumePartial.feature_audit === 'object'
      ? (resumePartial.feature_audit as FeatureAudit)
      : {}),
    clarify_questions: levelQuestions,
    comparative_questions: comparativeQuestions,
    grounded_feature_coverage:
      typeof data.grounded_feature_coverage === 'number' ? data.grounded_feature_coverage : undefined,
    cross_option_discrimination:
      typeof data.cross_option_discrimination === 'number' ? data.cross_option_discrimination : undefined,
    alignment_report:
      data.alignment_report && typeof data.alignment_report === 'object'
        ? (data.alignment_report as FeatureAudit['alignment_report'])
        : undefined,
    needs_scoring_clarification: true,
  };
  return {
    decisionId,
    levelQuestions,
    comparativeQuestions,
    coverage: typeof data.grounded_feature_coverage === 'number' ? data.grounded_feature_coverage : undefined,
    discrimination:
      typeof data.cross_option_discrimination === 'number' ? data.cross_option_discrimination : undefined,
    audit: auditFromGate,
    optionNames,
    resumePartial,
    decisionPrompt,
    elicitationRound: typeof data.elicitation_round === 'number' ? data.elicitation_round : undefined,
    maxElicitationRounds:
      typeof data.max_elicitation_rounds === 'number' ? data.max_elicitation_rounds : undefined,
    validationErrors: Array.isArray(data.validation_errors)
      ? (data.validation_errors as string[])
      : undefined,
  };
}

export type { ElicitationSubmitPayload };
