import type { ClarifyQuestion } from '../ClarifyDialog';
import type { ClarificationGateMeta } from './ClarificationCard';
import type { ShadowMessage, ShadowSuggestion } from './types';

export type PendingActionType = 'clarification' | 'decision_report' | 'role_mode';

export type PendingAction = {
  id: string;
  type: PendingActionType;
  title: string;
  message: string;
  blocks: string[];
  payload: Record<string, unknown>;
  created_at?: string;
  why?: string;
};

export function pendingActionToSuggestion(pa: PendingAction | null | undefined): ShadowSuggestion | null {
  if (!pa || pa.type === 'clarification') return null;
  if (pa.type === 'decision_report') {
    return { type: 'decision_report', title: pa.title, message: pa.message };
  }
  if (pa.type === 'role_mode') {
    return { type: 'role_mode', title: pa.title, message: pa.message };
  }
  return null;
}

export function clarificationFromPendingAction(pa: PendingAction | null | undefined): {
  questions: ClarifyQuestion[];
  note: string;
  meta: ClarificationGateMeta | null;
} | null {
  if (!pa || pa.type !== 'clarification') return null;
  const payload = pa.payload || {};
  const questions = payload.questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const metaRaw = payload.meta;
  const meta =
    metaRaw && typeof metaRaw === 'object' ? (metaRaw as ClarificationGateMeta) : null;
  return {
    questions: questions as ClarifyQuestion[],
    note: typeof payload.note === 'string' ? payload.note : '',
    meta,
  };
}

export function decisionPromptFromPendingAction(pa: PendingAction | null | undefined): string {
  if (!pa || pa.type !== 'decision_report') return '';
  const p = pa.payload?.decision_prompt;
  return typeof p === 'string' ? p.trim() : '';
}

export function messagesHaveDecisionReportArtifact(messages: ShadowMessage[]): boolean {
  return messages.some((m) => String(m.metadata?.type || '') === 'decision_report_artifact');
}

/** Hide stale "generate report?" cards while generating or viewing a finished report in the panel. */
export function shouldSurfaceDecisionReportPending(
  pa: PendingAction | null | undefined,
  opts: {
    isReportGenerating?: boolean;
    hasReportArtifact?: boolean;
    reportPanelOpen?: boolean;
    reportComplete?: boolean;
  },
): boolean {
  if (!pa || pa.type !== 'decision_report') return Boolean(pa);
  if (opts.isReportGenerating) return false;
  if (opts.reportPanelOpen && opts.reportComplete) return false;
  if (opts.hasReportArtifact) {
    if (pa.payload?.manual_mode === true) return true;
    if (typeof pa.payload?.decision_prompt === 'string' && pa.payload.decision_prompt.trim()) return true;
    return false;
  }
  return true;
}

export function normalizeThreadMessages(raw: unknown): ShadowMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ShadowMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const role = String(m.role || 'assistant');
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
    out.push({
      id: String(m.id || `m-${out.length}-${Date.now()}`),
      role: role as ShadowMessage['role'],
      content: String(m.content ?? ''),
      created_at: typeof m.created_at === 'string' ? m.created_at : undefined,
      status: typeof m.status === 'string' ? m.status : undefined,
      metadata: m.metadata && typeof m.metadata === 'object' ? (m.metadata as Record<string, unknown>) : undefined,
    });
  }
  return out;
}

export function buildClarificationPendingAction(
  questions: ClarifyQuestion[],
  meta?: ClarificationGateMeta | null,
  note = '',
): PendingAction {
  return {
    id: `local-${Date.now()}`,
    type: 'clarification',
    title: 'One thing to clarify',
    message: 'Answer or skip so the next reply matches what you care about.',
    blocks: ['send_message', 'generate_decision_report'],
    payload: {
      questions,
      meta: meta || {},
      note,
      why: meta?.why_this_question || '',
    },
  };
}
