import type { ExecutionTask } from './executionScheduler';

const REPORT_EXECUTION_TASK_LIMIT = 4;

export function inferExecutionDurationMinutes(action: string): number {
  const low = action.toLowerCase();
  const minuteMatch = low.match(/\b(15|20|25|30|45|60|75|90|120)\s*(?:min|mins|minute|minutes)\b/);
  if (minuteMatch) return Number(minuteMatch[1]);
  const hourMatch = low.match(/\b([1-4])\s*(?:h|hr|hrs|hour|hours)\b/);
  if (hourMatch) return Math.min(180, Number(hourMatch[1]) * 60);
  if (/(call|email|message|text|dm|ask|confirm)/i.test(action)) return 30;
  if (/(compare|review|research|shortlist|find|list)/i.test(action)) return 45;
  if (/(write|draft|design|build|apply|application|prepare)/i.test(action)) return 90;
  return 45;
}

export function mapRecommendationActionsToTasks(
  actions: Array<{ action: string; deadline?: string | null }>,
): ExecutionTask[] {
  return (actions || []).slice(0, REPORT_EXECUTION_TASK_LIMIT).map((a, idx) => ({
    id: `na-${idx + 1}`,
    title: a.action,
    duration_minutes: inferExecutionDurationMinutes(a.action),
    description: `Decision report step ${idx + 1}`,
    priority: idx === 0 ? 'high' : 'medium',
    deadline_hint: a.deadline ?? undefined,
  }));
}
