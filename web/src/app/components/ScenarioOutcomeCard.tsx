import { ChevronRight } from 'lucide-react';
import { cn } from './ui/utils';

export interface ScenarioOutcomeCardProps {
  scenario: {
    label: string;
    trajectory: string;
    probability: number;
    key_drivers?: string[];
  };
}

function branchTitle(label: string): string {
  const lab = label.toLowerCase();
  if (lab === 'best') return 'Best-case branch';
  if (lab === 'base') return 'Base-case branch';
  if (lab === 'worst') return 'Stress / downside branch';
  return `${label} branch`;
}

/** One branch of agent-simulated future — compact by default; full narrative inside `<details>`. */
export function ScenarioOutcomeCard({ scenario }: ScenarioOutcomeCardProps) {
  const lab = scenario.label.toLowerCase();
  const isTri = lab === 'best' || lab === 'base' || lab === 'worst';
  const drivers = (scenario.key_drivers ?? []).map((d) => d.trim()).filter(Boolean);
  const t = scenario.trajectory.replace(/\s+/g, ' ').trim();
  const teaser = t.length > 100 ? `${t.slice(0, 100).trim()}…` : t;
  const shortStory = t.length <= 160;

  return (
    <article
      className={cn(
        'rounded-xl border p-3 shadow-sm transition-colors',
        isTri && lab === 'best' && 'border-emerald-200/90 bg-emerald-50/40',
        isTri && lab === 'base' && 'border-sky-200/85 bg-sky-50/35',
        isTri && lab === 'worst' && 'border-rose-200/85 bg-rose-50/35',
        !isTri && 'border-gray-200/80 bg-gray-50/50',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-600">
          Future branch · <span className="text-gray-900">{scenario.label}</span>
        </span>
        <span className="text-[10px] font-semibold text-gray-500">{branchTitle(scenario.label)}</span>
      </div>

      {drivers.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="What drives this branch">
          {drivers.slice(0, 6).map((d) => (
            <span
              key={d}
              className="max-w-[14rem] truncate rounded-full border border-gray-200/90 bg-white/90 px-2.5 py-0.5 text-[11px] font-medium text-gray-800"
              title={d}
            >
              {d}
            </span>
          ))}
          {drivers.length > 6 ? (
            <span className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10px] text-gray-500">
              +{drivers.length - 6}
            </span>
          ) : null}
        </div>
      ) : null}

      {shortStory ? (
        <div className="mt-2.5 rounded-lg border border-gray-200/70 bg-white/60 px-2.5 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">How this could unfold</p>
          <p className="mt-1 text-sm leading-relaxed text-gray-800">{t}</p>
        </div>
      ) : (
        <details className="group mt-2.5 rounded-lg border border-gray-200/80 bg-white/70 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-white/90">
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-purple-600 transition-transform group-open:rotate-90" />
            <span className="min-w-0 flex-1">
              <span className="text-xs font-bold text-purple-900">Storyline</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-gray-600 line-clamp-2">{teaser}</span>
            </span>
          </summary>
          <div className="border-t border-gray-100 px-3 pb-3 pt-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">How this could unfold</p>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{scenario.trajectory}</p>
          </div>
        </details>
      )}
    </article>
  );
}
