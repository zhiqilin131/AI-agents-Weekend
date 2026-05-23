import type { TherapyLabSessionState } from '../types';
import { TherapyLabPanel } from './TherapyLabChrome';

export function TherapyLabDebugPanel({ session }: { session: TherapyLabSessionState }) {
  const r = session.lastResult;
  return (
    <TherapyLabPanel className="p-4 text-xs">
      <p className="mb-2 font-semibold uppercase tracking-[0.16em] text-slate-500">Debug panel</p>
      <dl className="space-y-2 text-slate-700">
        <div>
          <dt className="font-medium text-slate-500">Selected exercise</dt>
          <dd>{session.selectedExercise ?? '—'}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Current step</dt>
          <dd className="break-words">{session.currentStep || '—'}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Before / after intensity</dt>
          <dd>
            {session.beforeIntensity ?? '—'} → {session.afterIntensity ?? r?.afterIntensity ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Result summary</dt>
          <dd className="break-words">{r?.resultSummary ?? '—'}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Memory candidate</dt>
          <dd className="break-words">{r?.memoryCandidate ?? '—'}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Next actions</dt>
          <dd className="break-words">
            {r?.nextActions?.length
              ? r.nextActions.map((a) => `${a.label}${a.calendarTitle ? ` (${a.calendarTitle})` : ''}`).join('; ')
              : '—'}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Calendar-safe title</dt>
          <dd className="break-words">
            {r?.nextActions?.find((a) => a.calendarTitle)?.calendarTitle ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Safety active</dt>
          <dd>{session.safetyActive ? 'yes' : 'no'}</dd>
        </div>
      </dl>
    </TherapyLabPanel>
  );
}
