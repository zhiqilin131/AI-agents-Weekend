import type { ExecutionTask } from './executionScheduler';

export type AgilityPreview = {
  summary: string;
  likely_consequences: string[];
  workload_impact: string;
  schedule_constraints: string[];
  risk_windows: string[];
  first_steps: Array<{ title: string; duration_minutes: number; deadline_hint?: string }>;
  review_checkpoint: string;
};

export function buildLocalAgilityPreview(args: {
  optionName: string;
  recommendationReasoning?: string;
  riskLabels?: string[];
  nextActions?: Array<{ text: string; deadline?: string }>;
}): AgilityPreview {
  void args.optionName;
  const steps = (args.nextActions || [])
    .slice(0, 3)
    .map((a, i) => ({
      title: a.text || `Execution step ${i + 1}`,
      duration_minutes: 60,
      deadline_hint: a.deadline,
    }));
  return {
    summary: '',
    likely_consequences: [
      'Early progress depends on turning intent into calendar-protected blocks quickly.',
      'Execution quality will improve if task switching is reduced during the first week.',
      'Visible progress in the first 48 hours increases commitment to the plan.',
    ],
    workload_impact:
      'Expect moderate workload compression in the first 3-5 days; reserve 1-2 focused blocks per day to avoid spillover.',
    schedule_constraints: [
      'Protect at least one uninterrupted deep-work block on weekdays.',
      'Avoid stacking all critical tasks on one day; spread across the week.',
      'Keep buffer time before hard deadlines for revision/recovery.',
    ],
    risk_windows: args.riskLabels && args.riskLabels.length > 0
      ? args.riskLabels.slice(0, 3).map((r) => `Watch for ${r} under time pressure.`)
      : ['Mid-week: plan drift if no review checkpoint is scheduled.'],
    first_steps: steps.length > 0 ? steps : [
      { title: 'Define first executable task and schedule it', duration_minutes: 60 },
      { title: 'Prepare required material/checklist', duration_minutes: 45 },
      { title: 'Run first checkpoint and adjust timing', duration_minutes: 30 },
    ],
    review_checkpoint: 'Run a 20-minute review checkpoint in 72 hours: what moved, what slipped, and what needs rescheduling.',
  };
}

export function mapPreviewStepsToTasks(preview: AgilityPreview): ExecutionTask[] {
  return preview.first_steps.map((s, idx) => ({
    id: `task-${idx + 1}`,
    title: s.title,
    duration_minutes: s.duration_minutes || 60,
    description: '',
    priority: idx === 0 ? 'high' : 'medium',
    deadline_hint: s.deadline_hint,
  }));
}
