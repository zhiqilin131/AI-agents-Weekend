import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Shield } from 'lucide-react';
import { MainNavButtons } from '../app/components/MainNavButtons';
import { JudgeJourneyNav } from '../features/resilience/JudgeJourneyNav';
import { ResilienceExplorer } from '../features/resilience/ResilienceExplorer';
import { ResilienceEvidencePanel, type ChaosLegRow } from '../features/resilience/ResilienceEvidencePanel';
import { ResilienceLiveTestPanel } from '../features/resilience/ResilienceLiveTestPanel';
import { cn } from '../app/components/ui/utils';
import { innerCard, pageBackdrop, pageGlow, shellCard } from '../features/resilience/resilienceStyles';
import { apiFetch } from '../utils/apiFetch';

type JudgePack = {
  generated_at?: string;
  version?: string;
  chaos_legs_summary?: ChaosLegRow[];
  artifacts?: { report_card_markdown?: string | null };
};

const HERO_STATS = [
  { label: 'Defense layers', value: '4', hint: 'Breaker · Gateway · Fallback · UI' },
  { label: 'Pipeline stages', value: '7', hint: 'Matches pipeline.py order' },
  { label: 'Chaos legs', value: '6', hint: 'FX_CHAOS harness' },
  { label: 'User data touched', value: '0', hint: 'Smoke test is isolated' },
];

export default function ResilienceReportPage() {
  const [pack, setPack] = useState<JudgePack | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [packLoading, setPackLoading] = useState(true);
  const loadPack = useCallback(async () => {
    setPackLoading(true);
    setPackError(null);
    try {
      const res = await apiFetch('/api/resilience/judge-pack');
      if (!res.ok) throw new Error(await res.text());
      setPack((await res.json()) as JudgePack);
    } catch (e) {
      setPackError(e instanceof Error ? e.message : 'Could not load report');
    } finally {
      setPackLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPack();
  }, [loadPack]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const legs = pack?.chaos_legs_summary ?? [];
  const passCount = legs.filter((l) => l.pass).length;

  return (
    <div className={pageBackdrop}>
      <div className={pageGlow} aria-hidden />

      <JudgeJourneyNav />

      <div className="relative z-10 mx-auto max-w-6xl px-5 pb-24 pt-4 sm:px-8">
        <MainNavButtons className="!mb-2" variant="compact" />

        <header id="journey-hero" className={cn(shellCard, 'scroll-mt-8 p-6 text-center sm:p-10')}>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-violet-600">To the judges</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-900 sm:text-5xl">
              We still ship decisions
              <span className="mt-1 block bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 bg-clip-text text-transparent">
                when dependencies fail
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-gray-600">
              Foresight-X treats OpenAI, Tavily, and MCP as unreliable infrastructure. We built circuit breakers, gateway
              failover, per-stage fallbacks, and honest degraded UI — then prove it with chaos injection and a live test
              you can run below.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.45 }}
            className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4"
          >
            {HERO_STATS.map((s) => (
              <div key={s.label} className={cn(innerCard, 'px-4 py-3')}>
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="mt-0.5 text-xs font-semibold text-gray-700">{s.label}</p>
                <p className="mt-1 text-[10px] text-gray-500">{s.hint}</p>
              </div>
            ))}
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.28 }}
            className="mt-8 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-900"
          >
            <Shield className="h-4 w-4 text-violet-600" aria-hidden />
            Step 2: explore the map · Step 3: run the live smoke test
          </motion.p>
        </header>

        <div className="mt-8">
          <ResilienceExplorer chaosLegPassCount={passCount} chaosLegTotal={legs.length || 6} />
        </div>

        <div className="mt-8 space-y-8">
          <ResilienceEvidencePanel
            legs={legs}
            markdown={pack?.artifacts?.report_card_markdown ?? undefined}
            packLoading={packLoading}
            packError={packError}
            onRefresh={() => void loadPack()}
          />

          <ResilienceLiveTestPanel />
        </div>
      </div>
    </div>
  );
}
