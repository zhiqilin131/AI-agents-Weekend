import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Pause, Play, Zap } from 'lucide-react';
import { cn } from '../../app/components/ui/utils';
import { ResilienceFlowDiagram } from './ResilienceFlowDiagram';
import {
  JUDGE_STORY_STEPS,
  NODE_DETAIL,
  PIPELINE_STAGE_META,
  RESILIENCE_NODES,
  RESILIENCE_SCENARIOS,
  STAGE_FALLBACK_COPY,
  type ResilienceNodeId,
  type ResilienceScenarioId,
  nodeStatusFor,
  scenarioById,
} from './resilienceModel';
import { innerCard, pillActive, pillIdle, shellCard } from './resilienceStyles';

function statusLabel(status: ReturnType<typeof nodeStatusFor>): string {
  switch (status) {
    case 'stress':
      return 'Fault injected';
    case 'fallback':
      return 'Graceful fallback';
    case 'bypass':
      return 'Bypassed';
    default:
      return 'Healthy';
  }
}

function statusBadgeClass(status: ReturnType<typeof nodeStatusFor>): string {
  switch (status) {
    case 'stress':
      return 'bg-rose-100 text-rose-800 ring-rose-200';
    case 'fallback':
      return 'bg-amber-100 text-amber-900 ring-amber-200';
    case 'bypass':
      return 'bg-slate-100 text-slate-600 ring-slate-200';
    default:
      return 'bg-emerald-100 text-emerald-800 ring-emerald-200';
  }
}

export function ResilienceExplorer({
  chaosLegPassCount,
  chaosLegTotal,
}: {
  chaosLegPassCount?: number;
  chaosLegTotal?: number;
}) {
  const [scenarioId, setScenarioId] = useState<ResilienceScenarioId>('healthy');
  const [selectedNode, setSelectedNode] = useState<ResilienceNodeId>('llm_gateway');
  const [autoTour, setAutoTour] = useState(false);

  const scenario = useMemo(() => scenarioById(scenarioId), [scenarioId]);
  const detail = NODE_DETAIL[selectedNode];
  const selectedMeta = RESILIENCE_NODES[selectedNode];
  const selectedStatus = nodeStatusFor(scenario, selectedNode);
  const stageMeta = PIPELINE_STAGE_META.find((s) => s.id === selectedNode);

  const advanceTour = useCallback(() => {
    setScenarioId((current) => {
      const idx = RESILIENCE_SCENARIOS.findIndex((s) => s.id === current);
      return RESILIENCE_SCENARIOS[(idx + 1) % RESILIENCE_SCENARIOS.length].id;
    });
  }, []);

  useEffect(() => {
    if (!autoTour) return;
    const id = window.setInterval(advanceTour, 4500);
    return () => window.clearInterval(id);
  }, [autoTour, advanceTour]);

  useEffect(() => {
    if (scenarioId === 'primary_5xx' || scenarioId === 'primary_429') setSelectedNode('llm_gateway');
    else if (scenarioId === 'tavily_outage') setSelectedNode('tavily');
    else if (scenarioId === 'linear_mcp_outage') setSelectedNode('linear_mcp');
  }, [scenarioId]);

  return (
    <section id="resilience-explorer" className={cn(shellCard, 'scroll-mt-8 p-6 sm:p-8')}>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-600">Step 2</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            Resilience architecture map
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-600">
            Click any node to inspect behavior. Switch scenarios to see faults propagate — green is healthy, red is
            injected, amber is fallback.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chaosLegTotal != null && chaosLegTotal > 0 ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
              Chaos demo {chaosLegPassCount ?? 0}/{chaosLegTotal} PASS
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setAutoTour((v) => !v)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition',
              autoTour
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100',
            )}
          >
            {autoTour ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {autoTour ? 'Pause tour' : 'Auto tour'}
          </button>
        </div>
      </div>

      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {RESILIENCE_SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setScenarioId(s.id);
              setAutoTour(false);
            }}
            className={scenarioId === s.id ? pillActive : pillIdle}
          >
            {s.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={scenarioId}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className={cn(innerCard, 'mb-6 p-4 sm:p-5')}
        >
          <div className="flex gap-3">
            <Zap className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">{scenario.tagline}</p>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{scenario.judgePitch}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <p className="rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs text-rose-900">
                  <span className="font-semibold">Injected · </span>
                  {scenario.injectedFault}
                </p>
                <p className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-900">
                  <span className="font-semibold">Still delivers · </span>
                  {scenario.stillDelivers}
                </p>
              </div>
              <p className="mt-3 text-xs text-gray-500">{scenario.pipelineNote}</p>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <ResilienceFlowDiagram
          scenario={scenario}
          selectedNode={selectedNode}
          onSelectNode={setSelectedNode}
        />

        <aside className="flex flex-col gap-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedNode + scenarioId}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className={cn(innerCard, 'p-4')}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-violet-600">Selected component</p>
              <h3 className="mt-1 text-lg font-bold text-gray-900">{selectedMeta.label}</h3>
              <span
                className={cn(
                  'mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ring-1',
                  statusBadgeClass(selectedStatus),
                )}
              >
                {statusLabel(selectedStatus)}
              </span>

              {stageMeta ? (
                <div className="mt-4 space-y-2 text-sm text-gray-700">
                  <p>
                    <span className="font-semibold text-violet-800">Stage #{stageMeta.order}</span> in pipeline.py
                  </p>
                  <p className="text-xs text-gray-600">Fallback: {stageMeta.fallback}</p>
                  {stageMeta.usesLlm ? (
                    <p className="text-xs text-violet-700">Uses LLM gateway when available</p>
                  ) : null}
                  {stageMeta.usesTavily ? (
                    <p className="text-xs text-sky-700">Uses Tavily web retrieval</p>
                  ) : null}
                </div>
              ) : detail ? (
                <div className="mt-4 space-y-3 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-emerald-800">When healthy</p>
                    <p className="mt-1 text-gray-700">{detail.healthy}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-amber-800">On fault</p>
                    <p className="mt-1 text-gray-700">{detail.onFault}</p>
                  </div>
                  <p className="rounded-lg bg-gray-100 px-2.5 py-1.5 font-mono text-[10px] text-gray-600">
                    {detail.implementation}
                  </p>
                </div>
              ) : selectedNode.startsWith('stage_') ? (
                <p className="mt-3 text-sm text-gray-700">
                  {STAGE_FALLBACK_COPY[selectedNode.replace('stage_', '')] ??
                    'Stage-level deterministic fallback.'}
                </p>
              ) : (
                <p className="mt-3 text-sm text-gray-500">Click any node in the map.</p>
              )}
            </motion.div>
          </AnimatePresence>

          <div className={cn(innerCard, 'p-4')}>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Legend</p>
            <ul className="mt-2 space-y-1.5 text-xs text-gray-600">
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Healthy
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                Injected fault
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Fallback active
              </li>
            </ul>
          </div>
        </aside>
      </div>

      <div className="mt-8 border-t border-violet-100/80 pt-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Why we built this</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {JUDGE_STORY_STEPS.map((step) => (
            <div key={step.step} className={cn(innerCard, 'p-3')}>
              <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-violet-100 px-2 text-[10px] font-bold text-violet-700">
                {step.step}
              </span>
              <p className="mt-2 text-sm font-semibold text-gray-900">{step.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
