import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import { getSlimeIdentity } from '../features/slime/slimeIdentity';
import { useExecutionStorageUserKey } from '../hooks/useExecutionStorageUserKey';
import {
  THERAPY_EXERCISE_LABELS,
  type TherapyExerciseType,
  type TherapyLabSessionState,
} from '../features/therapyLab/types';
import { TherapyLabDebugPanel } from '../features/therapyLab/components/TherapyLabDebugPanel';
import { TherapyLabExerciseHost } from '../features/therapyLab/TherapyLabExerciseHost';
import { TherapyLabPanel, therapyLabTheme } from '../features/therapyLab/components/TherapyLabChrome';
import { cn } from '../app/components/ui/utils';

const EXERCISE_ORDER: TherapyExerciseType[] = [
  'breathing_guide',
  'emotion_check_in',
  'grounding_54321',
  'cbt_thought_reframe',
  'micro_action_plan',
];

const ident = getSlimeIdentity('wellbeing');

export default function RimumuTherapyLabPage() {
  const { storageUserKey, ready: storageReady } = useExecutionStorageUserKey();
  const [session, setSession] = useState<TherapyLabSessionState>({
    selectedExercise: null,
    currentStep: 'menu',
    lastResult: null,
    safetyActive: false,
  });

  const patchSession = (patch: Partial<TherapyLabSessionState>) => {
    setSession((s) => ({ ...s, ...patch }));
  };

  const selectExercise = (type: TherapyExerciseType) => {
    patchSession({
      selectedExercise: type,
      currentStep: 'start',
      lastResult: null,
      safetyActive: false,
      beforeIntensity: undefined,
      afterIntensity: undefined,
    });
  };

  return (
    <div
      className="min-h-[100dvh] px-4 py-6 sm:px-6 sm:py-8"
      style={{
        background: `linear-gradient(165deg, #fff 0%, ${ident.theme.highlight} 55%, ${ident.theme.surface} 100%)`,
      }}
    >
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              to="/buddy"
              className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-rose-800/80 hover:text-rose-900"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to Buddy
            </Link>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: ident.theme.primary }}>
              Rimumu · prototype
            </p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight" style={{ color: ident.theme.heading }}>
              <FlaskConical className="h-7 w-7" style={{ color: ident.theme.primary }} aria-hidden />
              Therapy Exercise Lab
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
              Standalone practice space for interactive exercises. Emotional support only — not diagnosis or
              medical treatment. One step at a time.
            </p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,220px)_1fr_minmax(0,260px)]">
          <aside className="space-y-2">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Exercises</p>
            {EXERCISE_ORDER.map((id) => {
              const meta = THERAPY_EXERCISE_LABELS[id];
              const active = session.selectedExercise === id;
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`therapy-lab-pick-${id}`}
                  onClick={() => selectExercise(id)}
                  className={cn(
                    'w-full rounded-xl border px-3 py-2.5 text-left transition',
                    active ? 'border-rose-300 bg-rose-50/90 shadow-sm' : 'border-rose-100/80 bg-white/80 hover:border-rose-200',
                  )}
                >
                  <span className="block text-sm font-semibold" style={{ color: ident.theme.heading }}>
                    {meta.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-600">{meta.blurb}</span>
                </button>
              );
            })}
          </aside>

          <main>
            {!session.selectedExercise ? (
              <TherapyLabPanel className="p-8 text-center">
                <p className="text-sm text-slate-600">Pick an exercise on the left to begin.</p>
              </TherapyLabPanel>
            ) : (
              <TherapyLabExerciseHost
                exercise={session.selectedExercise}
                session={session}
                onSessionUpdate={patchSession}
                storageUserKey={storageUserKey}
                storageReady={storageReady}
              />
            )}

            {session.lastResult ? (
              <TherapyLabPanel className="mt-4 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Last result</p>
                <p className="mt-2 text-sm text-slate-800">{session.lastResult.resultSummary}</p>
                <button
                  type="button"
                  className="mt-3 text-sm font-medium text-rose-800 underline"
                  onClick={() => patchSession({ selectedExercise: session.selectedExercise, currentStep: 'restart' })}
                >
                  Run again
                </button>
              </TherapyLabPanel>
            ) : null}
          </main>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <TherapyLabDebugPanel session={session} />
            <p className="mt-3 px-1 text-[10px] leading-relaxed text-slate-500">
              Debug data stays in this browser session until you refresh. Not wired to Rimumu chat yet.
            </p>
          </aside>
        </div>

        <p
          className="mt-8 text-center text-[11px] leading-relaxed text-slate-500"
          style={{ borderTop: `1px solid ${therapyLabTheme.border}44`, paddingTop: '1rem' }}
        >
          If you are in crisis or might harm yourself or someone else, stop here and contact emergency services or
          988 (U.S.).
        </p>
      </div>
    </div>
  );
}
