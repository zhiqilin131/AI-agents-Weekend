import { useState } from 'react';
import { SlimeAdvisor, type SlimeAdvisorState } from '../app/components/report/SlimeAdvisor';
import { DEFAULT_SLIME_PROFILE } from '../hooks/useSlimeProfile';
import type { SlimeType } from '../features/slime/slimeIdentity';

const STATES: SlimeAdvisorState[] = [
  'idle',
  'listening',
  'thinking',
  'remembering',
  'preparing',
  'speaking',
  'cautious',
  'celebrating',
];

/** Dev-only preview for 3D slime states (requires VITE_SLIME_3D=1). */
export default function SlimeDev3DPage() {
  const [state, setState] = useState<SlimeAdvisorState>('idle');
  const [slimeType, setSlimeType] = useState<SlimeType>('generalized');

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-white">
      <h1 className="mb-2 text-2xl font-semibold">Slime 3D dev preview</h1>
      <p className="mb-6 text-sm text-slate-400">
        Set <code className="text-violet-300">VITE_SLIME_3D=1</code> and reload. Drag the canvas view in Buddy for full hero stage.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {STATES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setState(s)}
            className={`rounded-lg px-3 py-1.5 text-sm ${state === s ? 'bg-violet-500' : 'bg-slate-800'}`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="mb-6 flex gap-2">
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm ${slimeType === 'generalized' ? 'bg-blue-600' : 'bg-slate-800'}`}
          onClick={() => setSlimeType('generalized')}
        >
          Mochi
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm ${slimeType === 'wellbeing' ? 'bg-rose-600' : 'bg-slate-800'}`}
          onClick={() => setSlimeType('wellbeing')}
        >
          Rimumu
        </button>
      </div>
      <div className="flex min-h-[320px] items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800">
        <SlimeAdvisor
          state={state}
          size="lg"
          slimeType={slimeType}
          profile={DEFAULT_SLIME_PROFILE}
          companionMode
        />
      </div>
    </div>
  );
}
