import { apiFetch } from '../../utils/apiFetch';
import type { ShadowThread } from '../../app/components/shadow/types';
import type { TherapyReport } from './therapySession';

export type TherapyStartResult =
  | { ok: true; thread: ShadowThread }
  | { ok: false; error: string; needsIntake?: boolean };

export async function postTherapyStart(threadId: string): Promise<TherapyStartResult> {
  const res = await apiFetch(
    `/api/shadow-chat/threads/${encodeURIComponent(threadId)}/therapy/start`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const t = await res.text();
    return {
      ok: false,
      error: t || 'Could not start therapy',
      needsIntake: t.includes('therapy_intake_required'),
    };
  }
  const data = (await res.json()) as { thread?: ShadowThread };
  if (!data.thread) {
    return { ok: false, error: 'Missing thread in response' };
  }
  return { ok: true, thread: data.thread };
}

export type TherapyEndResult =
  | { ok: true; thread: ShadowThread; therapy_report?: TherapyReport }
  | { ok: false; error: string };

export async function postTherapyEnd(threadId: string): Promise<TherapyEndResult> {
  const res = await apiFetch(
    `/api/shadow-chat/threads/${encodeURIComponent(threadId)}/therapy/end`,
    { method: 'POST' },
  );
  if (!res.ok) {
    return { ok: false, error: (await res.text()) || 'Could not end therapy' };
  }
  const data = (await res.json()) as {
    thread?: ShadowThread;
    therapy_report?: TherapyReport;
  };
  if (!data.thread) {
    return { ok: false, error: 'Missing thread in response' };
  }
  return { ok: true, thread: data.thread, therapy_report: data.therapy_report };
}
