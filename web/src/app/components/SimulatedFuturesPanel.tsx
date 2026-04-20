import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, Orbit, Sparkles } from 'lucide-react';
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
 * Interactive, motion-forward visualization for agent-simulated futures.
 */
export function SimulatedFuturesPanel({
  futures,
  optionTitleById,
  chosenOptionId,
}: SimulatedFuturesPanelProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [focusScenario, setFocusScenario] = useState<string | null>(null);

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
    return s.sort((a, b) => b.probability - a.probability);
  }, [active]);

  if (!active) return null;

  const displayTitle = optionTitleById.get(active.option_id) ?? active.option_id;
  const isChosen = Boolean(chosenOptionId && active.option_id === chosenOptionId);

  return (
    <div className="space-y-5">
      <p className="text-[11px] text-gray-600 leading-relaxed flex gap-2 items-start border-b border-gray-200/50 pb-3">
        <Sparkles className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" aria-hidden />
        <span>
          <span className="font-bold text-gray-800">Agent simulation:</span> explore each option — branch
          probabilities are illustrative. Drag your attention across branches; click to expand.
        </span>
      </p>

      {/* Option carousel / tabs */}
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
                onClick={() => {
                  setActiveIdx(i);
                  setFocusScenario(null);
                }}
                className={cn(
                  'relative px-3 py-2 rounded-xl text-xs font-semibold transition-colors min-w-0 max-w-full sm:max-w-[14rem]',
                  sel
                    ? 'text-purple-950 z-10'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50',
                )}
              >
                {sel && (
                  <motion.span
                    layoutId="future-tab-pill"
                    className="absolute inset-0 rounded-xl bg-white shadow-md shadow-purple-500/10 border border-purple-100/80"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5 min-w-0">
                  {ch && (
                    <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]" />
                  )}
                  <span className="truncate">{title}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active option header */}
      <motion.div
        key={active.option_id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-2xl border border-purple-200/50 bg-gradient-to-r from-white/90 via-purple-50/30 to-sky-50/25 p-4 shadow-lg shadow-purple-500/5"
      >
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-purple-800">
              <Orbit className="w-4 h-4 shrink-0" aria-hidden />
              <span className="text-[10px] uppercase tracking-widest font-bold">Timeline</span>
            </div>
            <p className="text-base text-gray-900 font-bold leading-snug mt-1">{displayTitle}</p>
            <p className="text-[11px] text-gray-500 font-mono mt-0.5">{active.option_id}</p>
          </div>
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/80 border border-purple-100/80 text-xs text-purple-900">
            <span className="font-bold">Horizon</span>
            <span>{active.time_horizon}</span>
            {isChosen && (
              <span className="ml-1 text-[10px] uppercase font-bold text-amber-700 bg-amber-100/90 px-2 py-0.5 rounded-full">
                aligned pick
              </span>
            )}
          </div>
        </div>

        {/* Scenario grid */}
        <div className="mt-4 grid gap-3 sm:grid-cols-1">
          <AnimatePresence mode="popLayout">
            {scenarios.map((s, si) => {
              const key = `${active.option_id}-${s.label}`;
              const expanded = focusScenario === key;
              const pct = Math.round(s.probability * 100);
              return (
                <motion.div
                  key={key}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: si * 0.04, duration: 0.2 }}
                >
                  <button
                    type="button"
                    onClick={() => setFocusScenario(expanded ? null : key)}
                    className={cn(
                      'w-full text-left rounded-xl transition-transform duration-200',
                      expanded ? 'ring-2 ring-purple-400/50 ring-offset-2' : 'hover:scale-[1.01]',
                    )}
                  >
                    <ScenarioOutcomeCard scenario={s} />
                  </button>
                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 ml-1 flex items-start gap-2 text-xs text-purple-900/90">
                        <ChevronRight className="w-4 h-4 shrink-0 mt-0.5" />
                        <p>
                          <span className="font-bold">{pct}%</span> mass on this branch — read as a sketch, not a
                          forecast. Adjust if your assumptions differ.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
