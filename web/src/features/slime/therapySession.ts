import type { ShadowThread } from '../../app/components/shadow/types';

export type TherapyStatus = 'not_started' | 'active' | 'ended';

export type TherapySession = {
  status?: TherapyStatus;
  intake_complete?: boolean;
  mood_score?: number;
  primary_concern?: string;
  session_goal?: string;
  optional_note?: string;
  check_in_count?: number;
  started_at?: string;
  ended_at?: string;
  report?: TherapyReport;
};

export type TherapyActionSuggestion = {
  title: string;
  rationale: string;
  calendar_hint?: string;
};

export type TherapyReport = {
  id: string;
  generated_at?: string;
  disclaimer?: string;
  executive_summary: string;
  session_summary: string;
  themes_observed?: string[];
  strengths_noticed?: string[];
  reflective_prompts?: string[];
  suggested_actions?: TherapyActionSuggestion[];
};

export function therapySessionFromThread(
  thread: ShadowThread | null | undefined,
): TherapySession | null {
  if (!thread) return null;
  const raw = thread.therapy_session ?? thread.wellbeing_session;
  if (!raw || typeof raw !== 'object') return null;
  return raw as TherapySession;
}

export function therapyStatusFromThread(thread: ShadowThread | null | undefined): TherapyStatus {
  const s = therapySessionFromThread(thread);
  const st = s?.status;
  if (st === 'active' || st === 'ended' || st === 'not_started') return st;
  if (s?.report) return 'ended';
  return 'not_started';
}

export function therapyReportFromThread(thread: ShadowThread | null | undefined): TherapyReport | null {
  const s = therapySessionFromThread(thread);
  const r = s?.report;
  if (!r || typeof r !== 'object') return null;
  const summary = (r as TherapyReport).executive_summary;
  if (typeof summary !== 'string' || !summary.trim()) return null;
  return r as TherapyReport;
}

/** Buddy voice is only available while a therapy session is actively in progress. */
export function canUseWellbeingBuddyVoice(thread: ShadowThread | null | undefined): boolean {
  return therapyStatusFromThread(thread) === 'active';
}

/** User-facing hint when voice is gated on the Buddy page (null = ready to talk). */
export function wellbeingBuddyGateHint(
  hasThreadId: boolean,
  thread: ShadowThread | null | undefined,
): string | null {
  if (!hasThreadId) {
    return 'Choose a session in Recent therapy on the left, or tap + New session.';
  }
  const status = therapyStatusFromThread(thread);
  if (status === 'ended') {
    return 'This session has ended. Start + New session on the left, or open your therapy report below.';
  }
  const intakeComplete = Boolean(
    thread?.therapy_session?.intake_complete ?? thread?.wellbeing_session?.intake_complete,
  );
  if (!intakeComplete) {
    return 'Complete your quick check-in, then tap Start therapy below.';
  }
  if (status === 'not_started') {
    return 'Tap Start therapy below to begin talking with Rimumu.';
  }
  return null;
}

export function therapyReportFromMessages(
  messages: Array<{ metadata?: Record<string, unknown> }> | undefined,
): TherapyReport | null {
  if (!messages?.length) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const md = messages[i]?.metadata;
    const isTherapy =
      md?.artifact_type === 'therapy_report' ||
      md?.type === 'therapy_report_artifact';
    if (isTherapy && md.therapy_report && typeof md.therapy_report === 'object') {
      return md.therapy_report as TherapyReport;
    }
  }
  return null;
}
