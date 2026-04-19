import { cn } from './ui/utils';

export interface ScenarioOutcomeCardProps {
  scenario: {
    label: string;
    trajectory: string;
    probability: number;
    key_drivers?: string[];
  };
}

/** One branch of agent-simulated future (best / base / worst, etc.). */
export function ScenarioOutcomeCard({ scenario }: ScenarioOutcomeCardProps) {
  const lab = scenario.label.toLowerCase();
  const isTri = lab === 'best' || lab === 'base' || lab === 'worst';
  const pct = Math.round(scenario.probability * 100);
  return (
    <div
      className={cn(
        'rounded-lg border p-3 space-y-2.5',
        isTri && lab === 'best' && 'border-emerald-200/90 bg-emerald-50/45',
        isTri && lab === 'base' && 'border-sky-200/85 bg-sky-50/40',
        isTri && lab === 'worst' && 'border-rose-200/85 bg-rose-50/40',
        !isTri && 'border-gray-200/80 bg-gray-50/50',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-600" style={{ fontWeight: 800 }}>
          Future branch · {scenario.label}
        </span>
        <span
          className="text-xs tabular-nums text-gray-800 bg-white/80 border border-gray-200/70 rounded-md px-2 py-0.5"
          style={{ fontWeight: 700 }}
        >
          {pct}% probability
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-200/90 overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            lab === 'best' && 'bg-emerald-500',
            lab === 'base' && 'bg-sky-500',
            lab === 'worst' && 'bg-rose-500',
            !isTri && 'bg-purple-500',
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase mb-1" style={{ fontWeight: 700 }}>
          How life could unfold
        </p>
        <p className="text-sm text-gray-800 leading-relaxed" style={{ fontWeight: 400 }}>
          {scenario.trajectory}
        </p>
      </div>
      {scenario.key_drivers && scenario.key_drivers.length > 0 && (
        <div className="pt-1 border-t border-gray-200/50">
          <p className="text-[10px] text-gray-500 uppercase mb-1" style={{ fontWeight: 700 }}>
            What drives this branch
          </p>
          <ul className="text-xs text-gray-700 list-disc ml-4 space-y-0.5">
            {scenario.key_drivers.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
