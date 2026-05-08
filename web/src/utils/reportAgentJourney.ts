/** Stages for Shadow Chat decision report streaming (aligned with pipeline status labels). */

export const REPORT_JOURNEY_STEPS = [
  { id: 'structuring', label: 'Structuring', description: 'Framing your decision and constraints.' },
  { id: 'memory', label: 'Memory', description: 'Reading relevant memory and context.' },
  { id: 'options', label: 'Options', description: 'Generating possible paths.' },
  { id: 'tradeoffs', label: 'Trade-offs', description: 'Comparing benefits, costs, and risks.' },
  { id: 'consequences', label: 'Consequences', description: 'Simulating likely outcomes.' },
  { id: 'recommendation', label: 'Recommendation', description: 'Building the final recommendation.' },
  { id: 'finalizing', label: 'Finalizing', description: 'Polishing the report.' },
] as const;

export type ReportJourneyStepId = (typeof REPORT_JOURNEY_STEPS)[number]['id'];

const LABEL_TO_INDEX: Record<string, number> = {
  'Structuring decision': 0,
  'Reading memory': 1,
  'Generating options': 2,
  'Evaluating trade-offs': 3,
  'Simulating consequences': 4,
  'Building recommendation': 5,
  'Finalizing report': 6,
  'Generating report': 0,
};

export function journeyIndexFromProgressLabel(progressLabel: string): number {
  const t = progressLabel.trim();
  if (t in LABEL_TO_INDEX) return LABEL_TO_INDEX[t]!;
  for (const [k, v] of Object.entries(LABEL_TO_INDEX)) {
    if (t.includes(k) || k.includes(t)) return v;
  }
  return 0;
}

export function journeyStateFromProgress(
  progressLabel: string,
  panelStatus: 'running' | 'complete' | 'error',
): { currentStep: ReportJourneyStepId; completedSteps: ReportJourneyStepId[] } {
  const n = REPORT_JOURNEY_STEPS.length;
  if (panelStatus === 'complete') {
    const all = REPORT_JOURNEY_STEPS.map((s) => s.id);
    return { currentStep: 'finalizing', completedSteps: all };
  }
  if (panelStatus === 'error') {
    const idx = Math.min(journeyIndexFromProgressLabel(progressLabel), n - 1);
    const cur = REPORT_JOURNEY_STEPS[idx]!.id;
    const completed = REPORT_JOURNEY_STEPS.slice(0, idx).map((s) => s.id);
    return { currentStep: cur, completedSteps: completed };
  }
  const idx = Math.min(journeyIndexFromProgressLabel(progressLabel), n - 1);
  const cur = REPORT_JOURNEY_STEPS[idx]!.id;
  const completed = REPORT_JOURNEY_STEPS.slice(0, idx).map((s) => s.id);
  return { currentStep: cur, completedSteps: completed };
}
