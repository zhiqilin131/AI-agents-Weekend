import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Orbit, Sparkles } from 'lucide-react';
import { ScenarioOutcomeCard } from './ScenarioOutcomeCard';
import { cn } from './ui/utils';

export interface SimulatedFuturesPanelProps {
  futures: Array<{
    option_id: string;
    time_horizon: string;
    scenarios?: Array<{
      label: string;
      trajectory: string;
      probability: number;
      key_drivers?: string[];
    }>;
  }>;
  optionTitleById: Map<string, string>;
  chosenOptionId?: string;
}

/**
 * Per-option simulated futures — compact cards; full narrative lives in each card’s expandable “Storyline”.
 */
export function SimulatedFuturesPanel({
  futures,
  optionTitleById,
  chosenOptionId,
}: SimulatedFuturesPanelProps) {
  const [activeIdx, setActiveIdx] = useState(0);

  const ordered = useMemo(() => {
    return [...futures].sort((a, b) => {
      if (chosenOptionId && a.option_id === chosenOptionId) return -1;
      if (chosenOptionId && b.option_id === chosenOptionId) return 1;
      return 0;
    });
  }, [futures, chosenOptionId]);

  const active = ordered[activeIdx] ?? ordered[0];
  const scenarios = useMemo(() => {
    const s = [...(active?.scenarios ?? [])];
    /* Order branches for reading flow only — we do not show numeric “probability”. */
    const rank = (lab: string) => {
      const l = lab.toLowerCase();
      if (l === 'best') return 0;
      if (l === 'base') return 1;
      if (l === 'worst') return 2;
      return 3;
    };
    return s.sort((a, b) => rank(a.label) - rank(b.label));
  }, [active]);

  if (!active) return null;

  const displayTitle = optionTitleById.get(active.option_id) ?? active.option_id;
  const isChosen = Boolean(chosenOptionId && active.option_id === chosenOptionId);

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 border-b border-gray-200/50 pb-2.5 text-[11px] leading-relaxed text-gray-600">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-purple-600" aria-hidden />
        <span>
          <span className="font-semibold text-gray-800">Simulation detail</span> — pick an option, then expand each
          branch’s <span className="font-semibold">Storyline</span> when you want the full text. No percentage scores.
        </span>
      </p>

      <div className="relative rounded-2xl border border-white/60 bg-gradient-to-br from-slate-900/[0.03] via-purple-50/40 to-sky-50/30 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
        <div className="flex flex-wrap gap-1.5">
          {ordered.map((f, i) => {
            const title = optionTitleById.get(f.option_id) ?? f.option_id;
            const sel = i === activeIdx;
            const ch = Boolean(chosenOptionId && f.option_id === chosenOptionId);
            return (
              <button
                key={f.option_id}
                type="button"
                onClick={() => setActiveIdx(i)}
                className={cn(
                  'relative max-w-full min-w-0 rounded-xl px-3 py-2 text-xs font-semibold transition-colors sm:max-w-[14rem]',
                  sel ? 'z-10 text-purple-950' : 'text-gray-600 hover:bg-white/50 hover:text-gray-900',
                )}
              >
                {sel && (
                  <motion.span
                    layoutId="future-tab-pill"
                    className="absolute inset-0 rounded-xl border border-purple-100/80 bg-white shadow-md shadow-purple-500/10"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative z-10 flex min-w-0 items-center gap-1.5">
                  {ch && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]" />
                  )}
                  <span className="truncate">{title}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <motion.div
        key={active.option_id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-2xl border border-purple-200/50 bg-gradient-to-r from-white/90 via-purple-50/30 to-sky-50/25 p-4 shadow-lg shadow-purple-500/5"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-purple-800">
              <Orbit className="h-4 w-4 shrink-0" aria-hidden />
              <span className="text-[10px] font-bold uppercase tracking-widest">Branches</span>
            </div>
            <p className="mt-1 text-base font-bold leading-snug text-gray-900">{displayTitle}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="rounded-full border border-purple-100/80 bg-white/80 px-3 py-1.5 text-xs text-purple-900">
              <span className="font-bold">Horizon</span> {active.time_horizon}
            </span>
            {isChosen ? (
              <span className="rounded-full bg-amber-100/90 px-2 py-1 text-[10px] font-bold uppercase text-amber-800">
                Recommended option
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-1">
          <AnimatePresence mode="popLayout">
            {scenarios.map((s, si) => {
              const key = `${active.option_id}-${s.label}`;
              return (
                <motion.div
                  key={key}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: si * 0.03, duration: 0.18 }}
                >
                  <ScenarioOutcomeCard scenario={s} />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
