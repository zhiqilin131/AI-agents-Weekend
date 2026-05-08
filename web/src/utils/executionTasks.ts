import type { ExecutionTask } from './executionScheduler';

export function mapRecommendationActionsToTasks(
  actions: Array<{ action: string; deadline?: string | null }>,
): ExecutionTask[] {
  return (actions || []).map((a, idx) => ({
    id: `na-${idx + 1}`,
    title: a.action,
    duration_minutes: 60,
    priority: idx === 0 ? 'high' : 'medium',
    deadline_hint: a.deadline ?? undefined,
  }));
}
