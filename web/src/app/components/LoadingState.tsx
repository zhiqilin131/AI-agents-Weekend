import { Progress } from './ui/progress';

interface LoadingStateProps {
  progress: number;
  stageLabel: string;
  /** Only the progress strip (when partial results are shown below). */
  compact?: boolean;
}

export function LoadingState({ progress, stageLabel, compact }: LoadingStateProps) {
  const pct = Math.min(100, Math.max(0, progress));
  const bar = (
    <div className={compact ? 'p-4' : 'p-6'}>
      <p className="text-sm text-gray-700 mb-3" style={{ fontWeight: 500 }}>
        {stageLabel}
      </p>
      <Progress value={pct} className="h-2 bg-purple-100" />
      <p className="text-xs text-gray-500 mt-2" style={{ fontWeight: 400 }}>
        {compact
          ? `${pct.toFixed(0)}% — partial results update as each stage finishes`
          : `${pct.toFixed(0)}% — pipeline stages (LLM calls may take 1–3 min total)`}
      </p>
    </div>
  );

  if (compact) {
    return (
      <div className="rounded-2xl bg-white/70 backdrop-blur-xl border border-white/80 shadow-sm">
        {bar}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[28px] shadow-sm">
        {bar}
      </div>

      <div className="p-10 bg-white/50 backdrop-blur-2xl border border-white/80 rounded-[32px] shadow-[0_8px_32px_rgba(0,0,0,0.06)] animate-pulse">
        <div className="h-5 w-28 bg-gray-200/60 rounded-full mb-5"></div>
        <div className="space-y-3">
          <div className="h-4 bg-gray-200/60 rounded-full w-full"></div>
          <div className="h-4 bg-gray-200/60 rounded-full w-5/6"></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-7 bg-white/50 backdrop-blur-2xl border border-white/80 rounded-[28px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] animate-pulse">
            <div className="h-4 w-24 bg-gray-200/60 rounded-full mb-5"></div>
            <div className="space-y-2.5">
              <div className="h-3 bg-gray-200/60 rounded-full w-full"></div>
              <div className="h-3 bg-gray-200/60 rounded-full w-4/5"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
