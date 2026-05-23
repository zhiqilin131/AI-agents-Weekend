import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  Brain,
  Clock,
  Gauge,
  Layers,
  ListChecks,
  MessageCircle,
  Star,
  Undo2,
} from 'lucide-react';
import type { DecisionReport, ResourceDrop } from '../model';
import { RESOURCE_DROP_CALENDAR_ID } from '../model';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './ui/accordion';
import { SimulatedFuturesPanel } from './SimulatedFuturesPanel';
import { TradeoffsRadarChart } from './TradeoffsRadarChart';
import { MarkdownContent } from './MarkdownContent';
import { TypewriterText } from './TypewriterText';
import { cn } from './ui/utils';
import { apiFetch } from '../../utils/apiFetch';
import { useSlimeModelCatalog } from '../../features/models/useSlimeModelCatalog';
import { OptionCoachPanel, type CoachOptionContext } from './report/OptionCoachPanel';
import { fetchCalendarDraftFromReport } from '../../utils/calendarAgentApi';
import { CALENDAR_AGENT_SESSION_DRAFT_KEY, isReportCalendarApplied } from '../../utils/executionStorageKeys';
import { useExecutionStorageUserKey } from '../../hooks/useExecutionStorageUserKey';
import type { TraceUserStateLite } from '../../utils/evidenceDetailFromTrace';
import { AssumptionsCard } from './report/AssumptionsCard';
import { FuturePathsCard } from './report/FuturePathsCard';
import { NextActionCard } from './report/NextActionCard';
import { PersonalizedFitCard } from './report/PersonalizedFitCard';
import { RecommendationCard } from './report/RecommendationCard';

function optionTierSurface(tier: 'high' | 'medium' | 'low'): string {
  switch (tier) {
    case 'high':
      return 'border-emerald-400/75 bg-gradient-to-br from-emerald-50/95 via-white/90 to-white/85';
    case 'medium':
      return 'border-amber-300/85 bg-gradient-to-br from-amber-50/85 via-white/88 to-white/82';
    default:
      return 'border-slate-200/80 bg-white/78';
  }
}

function tierCaption(tier: 'high' | 'medium' | 'low'): string {
  switch (tier) {
    case 'high':
      return 'Higher priority';
    case 'medium':
      return 'Mid priority';
    default:
      return 'Lower priority';
  }
}

interface TraceFuture {
  option_id: string;
  time_horizon: string;
  scenarios?: Array<{
    label: string;
    trajectory: string;
    probability: number;
    key_drivers?: string[];
  }>;
}

interface TraceEvidence {
  facts?: Array<{ text: string; confidence?: number; source_url?: string }>;
  base_rates?: Array<{ text: string; source_url?: string }>;
  recent_events?: Array<{ text: string; source_url?: string }>;
}

interface TraceMemoryBlock {
  behavioral_patterns?: string[];
  similar_past_decisions?: Array<{
    decision_id?: string;
    situation_summary?: string;
    chosen_option?: string;
    outcome?: string | null;
    timestamp?: string;
  }>;
  prior_outcomes_summary?: string;
  memory_evidence?: Array<{
    decision_id?: string;
    theme?: string;
    memory_summary?: string;
    source_excerpt?: string;
    outcome?: string;
    outcome_quality?: number | null;
    timestamp?: string;
    source_path?: string;
  }>;
}

interface ReportCompactProps {
  report: DecisionReport;
  fullTrace: Record<string, unknown> | null;
  tier3Profile?: {
    profile?: {
      user_id?: string;
      values?: string[];
      risk_posture?: string;
      recurring_themes?: string[];
      current_goals?: string[];
      known_constraints?: string[];
      n_decisions_summarized?: number;
      last_updated?: string;
      confidence?: number;
    };
    used_in_recommender?: boolean;
    use_threshold?: number;
    source?: string;
  } | null;
  isStreaming?: boolean;
  /** When set, calendar planning uses this instead of default router navigation (e.g. preserve Shadow Chat context). */
  onExecutionCalendarNavigate?: (decisionId: string) => void;
  /** Shadow / multi-tab: thread id for Calendar Agent linkage */
  shadowThreadId?: string | null;
}

export function ReportCompact({
  report,
  fullTrace,
  tier3Profile,
  isStreaming,
  onExecutionCalendarNavigate,
  shadowThreadId = null,
}: ReportCompactProps) {
  const navigate = useNavigate();
  const { storageUserKey } = useExecutionStorageUserKey();
  const slimeModels = useSlimeModelCatalog();
  const [modelOptionId, setModelOptionId] = useState('');
  useEffect(() => {
    if (slimeModels.ready && slimeModels.defaultModel && !modelOptionId) {
      setModelOptionId(slimeModels.defaultModel);
    }
  }, [slimeModels.ready, slimeModels.defaultModel, modelOptionId]);
  const futures = (fullTrace?.futures as TraceFuture[]) ?? [];
  const evidence = fullTrace?.evidence as TraceEvidence | undefined;
  const memoryTrace = fullTrace?.memory as TraceMemoryBlock | undefined;
  const chosenOptionId = report.recommendation.chosenOption?.trim() ?? '';
  const optionTitleById = new Map(report.options.map((o) => [o.id, o.name]));
  const decisionId = typeof fullTrace?.decision_id === 'string' ? fullTrace.decision_id : '';

  const prefetchExecutionDraft = useCallback(async () => {
    if (!decisionId) return;
    if (storageUserKey && isReportCalendarApplied(storageUserKey, decisionId)) {
      return;
    }
    const draft = await fetchCalendarDraftFromReport(decisionId, shadowThreadId ?? null);
    sessionStorage.setItem(CALENDAR_AGENT_SESSION_DRAFT_KEY, JSON.stringify({ draft }));
  }, [decisionId, shadowThreadId, storageUserKey]);
  const surface = report.reportSurface;
  const [resourceDrops, setResourceDrops] = useState<ResourceDrop[]>([]);
  const [resourceDropsLoading, setResourceDropsLoading] = useState(false);
  const [coachOption, setCoachOption] = useState<CoachOptionContext | null>(null);
  const tradeoffByOptionId = useMemo(
    () => new Map((report.tradeoffs?.rows ?? []).map((r) => [r.optionId, r.scores])),
    [report.tradeoffs?.rows],
  );
  const [mcdaOptionId, setMcdaOptionId] = useState<string>(chosenOptionId || report.options[0]?.id || '');
  const selectedTradeoff = useMemo(
    () => report.tradeoffs?.rows.find((r) => r.optionId === mcdaOptionId) ?? report.tradeoffs?.rows[0],
    [mcdaOptionId, report.tradeoffs?.rows],
  );
  const firstAction = report.actions[0]?.text || surface?.primaryNextAction?.text || '';
  const primaryRisk =
    report.reflection.uncertaintySources?.[0] ||
    report.reflection.possibleErrors?.[0] ||
    report.reflection.informationGaps?.[0] ||
    surface?.keyAssumptions?.[0] ||
    '';

  useEffect(() => {
    if (!decisionId) {
      setResourceDrops([]);
      setResourceDropsLoading(false);
      return;
    }
    if (isStreaming) return;
    let cancelled = false;
    setResourceDropsLoading(true);
    const q = modelOptionId ? `?model_option_id=${encodeURIComponent(modelOptionId)}` : '';
    void apiFetch(`/api/traces/${encodeURIComponent(decisionId)}/resource-drops${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('resource_drops'))))
      .then((data: { resource_drops?: ResourceDrop[] }) => {
        if (!cancelled) setResourceDrops(Array.isArray(data.resource_drops) ? data.resource_drops : []);
      })
      .catch(() => {
        if (!cancelled) setResourceDrops([]);
      })
      .finally(() => {
        if (!cancelled) setResourceDropsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [decisionId, isStreaming, modelOptionId]);

  const recommendationResourceDrops = useMemo(
    () => resourceDrops.filter((d) => d.id !== RESOURCE_DROP_CALENDAR_ID && d.action_type !== 'calendar'),
    [resourceDrops],
  );

  const tradeoffsPanel =
    report.tradeoffs && report.tradeoffs.rows.length > 0 ? (
      <section className="rounded-2xl bg-white/70 border border-white/80 p-4 shadow-sm space-y-3">
        <h3 className="text-sm text-gray-900 flex items-center gap-2" style={{ fontWeight: 700 }}>
          <Layers className="w-4 h-4 text-purple-600" aria-hidden />
          MCDA option analysis
        </h3>
        <p className="text-xs text-gray-600 leading-relaxed">
          Options are compared across EV, Risk, Regret, Uncertainty, and Goal Alignment. Use this panel to inspect each
          option&apos;s profile.
        </p>
        <div className="flex flex-wrap gap-2">
          {report.options.map((o) => {
            const selected = (selectedTradeoff?.optionId || '').trim() === o.id.trim();
            return (
              <button
                key={`mcda-${o.id}`}
                type="button"
                onClick={() => setMcdaOptionId(o.id)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs border transition-colors',
                  selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-indigo-50',
                )}
              >
                {o.name}
              </button>
            );
          })}
        </div>
        {selectedTradeoff && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
            <p className="text-xs text-indigo-900 mb-2" style={{ fontWeight: 700 }}>
              Selected: {selectedTradeoff.optionName}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {Object.entries(selectedTradeoff.scores).map(([k, v]) => (
                <div key={`${selectedTradeoff.optionId}-${k}`} className="rounded-lg bg-white border border-indigo-100 px-2 py-1.5">
                  <p className="text-[10px] text-gray-500 uppercase" style={{ fontWeight: 700 }}>
                    {k}
                  </p>
                  <p className="text-sm text-gray-900" style={{ fontWeight: 700 }}>
                    {v}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        <TradeoffsRadarChart tradeoffs={report.tradeoffs} />
      </section>
    ) : null;

  const optionWriteups = (
    <div className="space-y-4">
      {report.options.map((o) => {
        const tier = o.importanceTier ?? 'medium';
        const rank = o.importanceRank ?? 0;
        const rec = Boolean(o.isRecommended);
        return (
          <div key={o.id} className={cn('rounded-xl border p-3 space-y-3 shadow-sm', optionTierSurface(tier))}>
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="text-xs font-mono text-gray-500 truncate">{o.id}</span>
                {rank > 0 && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full bg-white/90 border border-gray-200/80 text-gray-800"
                    style={{ fontWeight: 700 }}
                  >
                    #{rank}
                  </span>
                )}
                <span
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full border',
                    tier === 'high' && 'bg-emerald-100/90 text-emerald-900 border-emerald-200',
                    tier === 'medium' && 'bg-amber-100/90 text-amber-900 border-amber-200',
                    tier === 'low' && 'bg-slate-100/90 text-slate-800 border-slate-200',
                  )}
                  style={{ fontWeight: 700 }}
                >
                  {tierCaption(tier)}
                </span>
              </div>
            </div>
            <div className="flex items-start gap-2 min-w-0">
              {rec ? (
                <Star
                  className="w-5 h-5 shrink-0 mt-0.5 text-amber-500 fill-amber-400 drop-shadow-sm"
                  strokeWidth={1.25}
                  aria-label="Recommended in final analysis"
                />
              ) : (
                <span className="w-5 shrink-0" aria-hidden />
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm text-gray-900 leading-snug" style={{ fontWeight: 700 }}>
                  {o.name}
                </p>
                <p className="text-sm text-gray-600 leading-relaxed">{o.description}</p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 border bg-gray-50/90 border-gray-200/60">
              <Undo2 className="w-4 h-4 shrink-0 mt-0.5 text-gray-600" aria-hidden />
              <div className="min-w-0">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide" style={{ fontWeight: 700 }}>
                  Cost of reversal
                </p>
                <p className="text-sm text-gray-900 leading-snug">{o.costOfReversal}</p>
              </div>
            </div>
            {o.keyAssumptions.length > 0 && (
              <ul className="text-xs text-gray-600 list-disc ml-4 space-y-0.5">
                {o.keyAssumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
            {!!decisionId && (
              <button
                type="button"
                onClick={() =>
                  setCoachOption({
                    id: o.id,
                    name: o.name,
                    description: o.description,
                    keyAssumptions: o.keyAssumptions,
                    costOfReversal: o.costOfReversal,
                    isRecommended: o.isRecommended,
                    importanceRank: o.importanceRank,
                    importanceTier: o.importanceTier,
                    tradeoffScores: tradeoffByOptionId.get(o.id),
                  })
                }
                className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-purple-200 bg-white/85 text-purple-800 hover:bg-purple-50"
              >
                <MessageCircle className="w-3.5 h-3.5" aria-hidden />
                Ask how to execute this option
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      {surface ? (
        <>
          <RecommendationCard
            report={report}
            isStreaming={isStreaming}
            executionCalendar={
              decisionId
                ? {
                    decisionId,
                    navigate,
                    onExecutionCalendarNavigate: onExecutionCalendarNavigate,
                    preNavigate: prefetchExecutionDraft,
                  }
                : undefined
            }
            resourceDrops={recommendationResourceDrops}
            resourceDropsLoading={resourceDropsLoading}
          />
          <DecisionBriefStrip
            recommendation={
              report.recommendation.chosenOptionName ||
              optionTitleById.get(chosenOptionId) ||
              report.recommendation.chosenOption
            }
            groundingNote={surface.groundingNote}
            firstAction={firstAction}
            primaryRisk={primaryRisk}
          />
          <NextActionCard
            actions={report.actions.map((a) => ({ text: a.text, deadline: a.deadline }))}
            fallbackPrimary={surface.primaryNextAction}
            decisionId={decisionId}
            onExecutionCalendarNavigate={onExecutionCalendarNavigate}
            navigate={navigate}
            suppressCalendarButton={false}
            preNavigate={decisionId ? prefetchExecutionDraft : undefined}
          />
          <PersonalizedFitCard
            surface={surface}
            memoryTrace={memoryTrace}
            userState={fullTrace?.user_state as TraceUserStateLite | undefined}
          />
          <Accordion type="multiple" defaultValue={[]} className="rounded-2xl border border-white/80 bg-white/50 px-2">
            <AccordionItem value="tradeoffs">
              <AccordionTrigger className="text-sm" style={{ fontWeight: 600 }}>
                Show detailed tradeoffs
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                {tradeoffsPanel ?? <p className="text-sm text-gray-600">No scoring grid was returned for this run.</p>}
                {optionWriteups}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="futures">
              <AccordionTrigger className="text-sm" style={{ fontWeight: 600 }}>
                Explore possible futures
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <FuturePathsCard
                  paths={surface.futurePaths}
                  memoryTrace={memoryTrace}
                  userState={fullTrace?.user_state as TraceUserStateLite | undefined}
                />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="assumptions">
              <AccordionTrigger className="text-sm" style={{ fontWeight: 600 }}>
                Check assumptions
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <AssumptionsCard assumptions={surface.keyAssumptions} />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="memories">
              <AccordionTrigger className="text-sm" style={{ fontWeight: 600 }}>
                Show memories used
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <EvidenceBlock
                  evidence={evidence}
                  patterns={report.insights.memoryPatterns}
                  memoryTrace={memoryTrace}
                />
                {tier3Profile?.profile ? <Tier3ProfileBlock tier3Profile={tier3Profile} fullTrace={fullTrace} /> : null}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="scoring">
              <AccordionTrigger className="text-sm" style={{ fontWeight: 600 }}>
                Show scoring details
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <MarkdownContent
                  content={report.situation || '…'}
                  className="text-sm leading-relaxed text-gray-700 [&_p]:text-sm [&_p]:text-gray-700"
                />
                <ReflectionBlock report={report} />
                {futures.length === 0 ? (
                  <p className="text-sm text-gray-500">No per-option simulations in this run.</p>
                ) : (
                  <SimulatedFuturesPanel
                    futures={futures}
                    optionTitleById={optionTitleById}
                    chosenOptionId={chosenOptionId || undefined}
                  />
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      ) : (
        <>
      <RecommendationCard
        report={report}
        isStreaming={isStreaming}
        executionCalendar={
          decisionId
            ? {
                decisionId,
                navigate,
                onExecutionCalendarNavigate: onExecutionCalendarNavigate,
                preNavigate: prefetchExecutionDraft,
              }
            : undefined
        }
        resourceDrops={recommendationResourceDrops}
        resourceDropsLoading={resourceDropsLoading}
      />

      {/* Quick insight icons — no long paragraphs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-xl bg-white/70 border border-white/80 px-3 py-2.5 flex items-center gap-2 shadow-sm">
          <Brain className="w-4 h-4 text-purple-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-gray-500 uppercase" style={{ fontWeight: 600 }}>Type</p>
            <p className="text-xs text-gray-900 truncate" style={{ fontWeight: 600 }}>
              {report.insights.decisionType ?? '—'}
            </p>
          </div>
        </div>
        <div className="rounded-xl bg-white/70 border border-white/80 px-3 py-2.5 flex items-center gap-2 shadow-sm">
          <Clock className="w-4 h-4 text-blue-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-gray-500 uppercase" style={{ fontWeight: 600 }}>Pressure</p>
            <p className="text-xs text-gray-900 truncate" style={{ fontWeight: 600 }}>
              {report.insights.timePressure ?? '—'}
            </p>
          </div>
        </div>
        <div className="rounded-xl bg-white/70 border border-white/80 px-3 py-2.5 flex items-center gap-2 shadow-sm">
          <Gauge className="w-4 h-4 text-amber-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-gray-500 uppercase" style={{ fontWeight: 600 }}>Stress & workload</p>
            <p className="text-xs text-gray-900 truncate" style={{ fontWeight: 600 }}>
              {report.insights.stress ?? '—'}
            </p>
          </div>
        </div>
        <div className="rounded-xl bg-white/70 border border-white/80 px-3 py-2.5 flex items-center gap-2 shadow-sm">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-gray-500 uppercase" style={{ fontWeight: 600 }}>Biases</p>
            <p className="text-xs text-gray-900 truncate" style={{ fontWeight: 600 }}>
              {(report.insights.biasRisks?.length ?? 0) > 0
                ? `${report.insights.biasRisks!.length} flagged`
                : 'None'}
            </p>
          </div>
        </div>
      </div>

      {tradeoffsPanel}

      {tier3Profile?.profile && (
        <Tier3ProfileBlock tier3Profile={tier3Profile} fullTrace={fullTrace} />
      )}

      <Accordion type="multiple" defaultValue={['situation', 'options', 'reflection']} className="rounded-2xl border border-white/80 bg-white/50 px-2">
        <AccordionItem value="situation">
          <AccordionTrigger className="text-sm" style={{ fontWeight: 600 }}>
            Situation & goals
          </AccordionTrigger>
          <AccordionContent>
            <MarkdownContent
              content={report.situation || '…'}
              className="text-sm leading-relaxed text-gray-700 [&_p]:text-sm [&_p]:text-gray-700"
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="options">
          <AccordionTrigger className="text-sm" style={{ fontWeight: 600 }}>
            Options ({report.options.length})
          </AccordionTrigger>
          <AccordionContent>{optionWriteups}</AccordionContent>
        </AccordionItem>

        <AccordionItem value="evidence">
          <AccordionTrigger className="text-sm" style={{ fontWeight: 600 }}>
            Memory & evidence
          </AccordionTrigger>
          <AccordionContent>
            <EvidenceBlock
              evidence={evidence}
              patterns={report.insights.memoryPatterns}
              memoryTrace={memoryTrace}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="futures">
          <AccordionTrigger className="text-sm" style={{ fontWeight: 600 }}>
            Simulated futures
          </AccordionTrigger>
          <AccordionContent>
            {futures.length === 0 ? (
              <p className="text-sm text-gray-500">…</p>
            ) : (
              <SimulatedFuturesPanel
                futures={futures}
                optionTitleById={optionTitleById}
                chosenOptionId={chosenOptionId || undefined}
              />
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="reflection">
          <AccordionTrigger className="text-sm" style={{ fontWeight: 600 }}>
            Reflection & risks
          </AccordionTrigger>
          <AccordionContent>
            <ReflectionBlock report={report} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
        </>
      )}

      <OptionCoachPanel
        open={Boolean(coachOption)}
        option={coachOption}
        decisionId={decisionId}
        onClose={() => setCoachOption(null)}
      />
    </div>
  );
}

function DecisionBriefStrip({
  recommendation,
  groundingNote,
  firstAction,
  primaryRisk,
}: {
  recommendation?: string;
  groundingNote: string;
  firstAction: string;
  primaryRisk: string;
}) {
  const cells = [
    {
      label: 'Decision',
      value: recommendation?.trim() || 'Recommendation pending',
      Icon: Star,
      tone: 'text-amber-600 bg-amber-50 border-amber-100',
    },
    {
      label: 'Why',
      value: groundingNote.trim() || 'Uses the strongest available fit signals.',
      Icon: Brain,
      tone: 'text-violet-600 bg-violet-50 border-violet-100',
    },
    {
      label: 'First move',
      value: firstAction.trim() || 'Choose one small next action before adding more detail.',
      Icon: ListChecks,
      tone: 'text-emerald-700 bg-emerald-50 border-emerald-100',
    },
    {
      label: 'Watch',
      value: primaryRisk.trim() || 'Revisit if new information changes the assumptions.',
      Icon: AlertTriangle,
      tone: 'text-rose-600 bg-rose-50 border-rose-100',
    },
  ];

  return (
    <section className="rounded-2xl border border-white/90 bg-white/78 p-3 shadow-sm backdrop-blur-md md:p-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {cells.map(({ label, value, Icon, tone }) => (
          <div key={label} className="flex min-w-0 items-start gap-2 rounded-xl border border-gray-100 bg-white/85 px-3 py-2.5">
            <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border', tone)}>
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
              <p className="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-gray-900">{value}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Tier3ProfileBlock({
  tier3Profile,
  fullTrace,
}: {
  tier3Profile: NonNullable<ReportCompactProps['tier3Profile']>;
  fullTrace: Record<string, unknown> | null;
}) {
  const p = tier3Profile.profile ?? {};
  const confidence = typeof p.confidence === 'number' ? p.confidence : 0;
  const threshold = typeof tier3Profile.use_threshold === 'number' ? tier3Profile.use_threshold : 0.3;
  const used = Boolean(tier3Profile.used_in_recommender);
  const userState = (fullTrace?.user_state as
    | {
        profile_values?: string[];
        profile_priorities?: string[];
        profile_constraints?: string[];
      }
    | undefined) ?? { profile_values: [], profile_priorities: [], profile_constraints: [] };

  const injectedCount =
    (userState.profile_values?.length ?? 0) +
    (userState.profile_priorities?.length ?? 0) +
    (userState.profile_constraints?.length ?? 0);

  return (
    <section className="rounded-xl border border-white/85 bg-white/70 p-3 shadow-sm space-y-2 md:rounded-2xl md:p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-gray-900 md:text-sm">
            <Brain className="h-3.5 w-3.5 shrink-0 text-violet-600 md:h-4 md:w-4" aria-hidden />
            Semantic profile (Tier 3)
          </h3>
          <p className="mt-0.5 text-[10px] leading-snug text-gray-500 md:text-[11px]">
            Injected into this run’s recommender context.
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[9px] md:text-[10px]',
            used
              ? 'border-emerald-200 bg-emerald-100 text-emerald-900'
              : 'border-amber-200 bg-amber-100 text-amber-900',
          )}
          style={{ fontWeight: 700 }}
        >
          {used ? 'Used' : 'Low weight'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 md:gap-2">
        <MiniMetric label="Confidence" value={confidence.toFixed(2)} />
        <MiniMetric label="Threshold" value={threshold.toFixed(2)} />
        <MiniMetric label="Risk posture" value={p.risk_posture || 'unknown'} />
        <MiniMetric label="Decisions Σ" value={String(p.n_decisions_summarized ?? 0)} />
      </div>

      <div className="rounded-md border border-violet-100 bg-violet-50/70 px-2 py-1.5 text-[10px] leading-snug text-gray-600">
        Injected fields this run: <span className="font-semibold text-gray-800">{injectedCount}</span>
        {(userState.profile_values?.length ?? 0) > 0 ? ` · v${userState.profile_values?.length ?? 0}` : ''}
        {(userState.profile_priorities?.length ?? 0) > 0 ? ` · p${userState.profile_priorities?.length ?? 0}` : ''}
        {(userState.profile_constraints?.length ?? 0) > 0 ? ` · c${userState.profile_constraints?.length ?? 0}` : ''}
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2 md:gap-2">
        <StringList title="Values" items={p.values ?? []} />
        <StringList title="Recurring themes" items={p.recurring_themes ?? []} />
        <StringList title="Current goals" items={p.current_goals ?? []} />
        <StringList title="Known constraints" items={p.known_constraints ?? []} />
      </div>

      <p className="text-[9px] text-gray-500 md:text-[10px]">
        {tier3Profile.source || 'unknown'}
        {p.last_updated ? ` · ${p.last_updated}` : ''}
      </p>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200/80 bg-white/90 px-2 py-1.5 md:rounded-lg md:px-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 md:text-[10px]">{label}</p>
      <p className="truncate text-[11px] font-bold text-gray-900 md:text-xs">{value}</p>
    </div>
  );
}

function StringList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) {
    return (
      <div className="rounded-md border border-gray-200/80 bg-white/80 px-2 py-1.5 md:rounded-lg md:px-2.5">
        <p className="text-[10px] font-bold text-gray-500">{title}</p>
        <p className="text-[11px] text-gray-400">—</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-gray-200/80 bg-white/80 px-2 py-1.5 md:rounded-lg md:px-2.5">
      <p className="text-[10px] font-bold text-gray-500">{title}</p>
      <ul className="ml-3 list-disc space-y-0 text-[11px] leading-snug text-gray-800 md:text-xs">
        {items.slice(0, 4).map((x, i) => (
          <li key={`${title}-${i}`}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceBlock({
  evidence,
  patterns,
  memoryTrace,
}: {
  evidence?: TraceEvidence;
  patterns?: string[];
  memoryTrace?: TraceMemoryBlock;
}) {
  const facts = evidence?.facts ?? [];
  const rates = evidence?.base_rates ?? [];
  const recent = evidence?.recent_events ?? [];
  const memoryEvidence = memoryTrace?.memory_evidence ?? [];
  const liveReferenceCount = rates.filter((r) => (r.text || '').toLowerCase().startsWith('live reference')).length;
  const sourceHosts = (() => {
    const hosts = new Set<string>();
    for (const x of [...facts, ...rates, ...recent]) {
      const raw = (x.source_url ?? '').trim();
      if (!raw) continue;
      try {
        hosts.add(new URL(raw).hostname);
      } catch {
        // ignore malformed URLs in diagnostics
      }
    }
    return [...hosts].slice(0, 5);
  })();
  const patternList = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of patterns ?? []) {
      const k = p.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(p);
      if (out.length >= 8) break;
    }
    return out;
  })();

  return (
    <div className="space-y-3 text-sm">
      <div className="text-[11px] text-gray-500 leading-relaxed border-b border-gray-200/60 pb-2 mb-1 space-y-1.5">
        <p>
          <span style={{ fontWeight: 600 }}>Vector memory</span> — similar past decisions you stored in this app (not
          your full chat transcript). <span style={{ fontWeight: 600 }}>Patterns</span> are short labels derived from
          those records.
          <span className="mx-1">·</span>
          <span style={{ fontWeight: 600 }}>Facts</span> — static or cached reference snippets from the world index.
          <span className="mx-1">·</span>
          <span style={{ fontWeight: 600 }}>Base rates</span> (<span className="text-amber-800/95">baseline</span>) —
          priors / heuristic rates and <em>all live web search lines</em> (Tavily), shown as &quot;Live reference…&quot;.
          <span className="mx-1">·</span>
          <span style={{ fontWeight: 600 }}>Recent</span> — only non-web event lines (rare); web results are not listed
          here. Career demo seeds are hidden when your decision type is not career/academic.
        </p>
        <details className="group rounded-md bg-gray-50/90 border border-gray-100 px-2 py-1.5">
          <summary className="cursor-pointer list-none text-purple-800/90 [&::-webkit-details-marker]:hidden flex items-center gap-1 select-none">
            <span className="text-[10px]" style={{ fontWeight: 600 }}>
              Stale seed text after an update?
            </span>
            <span className="text-[10px] text-gray-400 group-open:hidden">▼</span>
            <span className="text-[10px] text-gray-400 hidden group-open:inline">▲</span>
          </summary>
          <p className="mt-1.5 text-[10px] text-gray-600 leading-relaxed">
            Delete <code className="rounded bg-white px-1 py-0.5 border border-gray-200/80">data/chroma</code> and
            re-run so the vector index rebuilds.
          </p>
        </details>
        <div className="rounded-md bg-indigo-50/90 border border-indigo-100 px-2 py-1.5 text-[10px] text-indigo-900 leading-relaxed">
          Diagnostics — facts: {facts.length}, base rates: {rates.length}, recent events: {recent.length}, live references: {liveReferenceCount}
          {sourceHosts.length > 0 ? `, sources: ${sourceHosts.join(', ')}` : ', sources: none'}
        </div>
      </div>
      {(memoryTrace?.prior_outcomes_summary || '').trim().length > 0 && (
        <div className="rounded-lg border border-violet-200/80 bg-violet-50/60 px-3 py-2">
          <p className="text-[10px] text-violet-900 uppercase mb-1" style={{ fontWeight: 700 }}>
            Prior outcomes summary (memory)
          </p>
          <MarkdownContent
            content={memoryTrace?.prior_outcomes_summary ?? ''}
            className="text-xs leading-relaxed text-gray-800 [&_p]:text-xs [&_p]:text-gray-800"
          />
        </div>
      )}

      {memoryTrace?.similar_past_decisions && memoryTrace.similar_past_decisions.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1" style={{ fontWeight: 600 }}>
            <Brain className="w-3.5 h-3.5" aria-hidden />
            Similar past decisions (retrieved)
          </p>
          <ul className="space-y-2">
            {memoryTrace.similar_past_decisions.slice(0, 5).map((d, i) => (
              <li
                key={d.decision_id ?? i}
                className="text-xs text-gray-800 rounded-lg border border-gray-200/80 bg-white/80 px-2.5 py-2 leading-relaxed"
              >
                <span className="text-[10px] text-gray-500 font-mono block mb-0.5">{d.decision_id ?? '—'}</span>
                {d.situation_summary ?? '—'}
                {(d.chosen_option || '').length > 0 && (
                  <span className="block mt-1 text-gray-600">
                    <span style={{ fontWeight: 600 }}>Chose: </span>
                    {d.chosen_option}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {memoryEvidence.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1" style={{ fontWeight: 600 }}>
            <ListChecks className="w-3.5 h-3.5" aria-hidden />
            Source-grounded memory evidence
          </p>
          <ul className="space-y-2">
            {memoryEvidence.slice(0, 6).map((row, i) => (
              <li
                key={`${row.decision_id ?? 'mem'}-${i}`}
                className="text-xs text-gray-800 rounded-lg border border-gray-200/80 bg-white/80 px-2.5 py-2 leading-relaxed"
              >
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-[10px] text-gray-500 font-mono">{row.decision_id ?? '—'}</span>
                  {row.theme && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-900">
                      {row.theme}
                    </span>
                  )}
                  {typeof row.outcome_quality === 'number' && (
                    <span className="text-[10px] text-gray-500">q={row.outcome_quality}/5</span>
                  )}
                </div>
                {(row.memory_summary || '').trim().length > 0 && (
                  <p className="text-gray-800">
                    <span style={{ fontWeight: 600 }}>Memory: </span>
                    {row.memory_summary}
                  </p>
                )}
                {(row.source_excerpt || '').trim().length > 0 && (
                  <p className="mt-1 text-gray-700">
                    <span style={{ fontWeight: 600 }}>Source: </span>
                    {row.source_excerpt}
                  </p>
                )}
                {(row.outcome || '').trim().length > 0 && (
                  <p className="mt-1 text-gray-700">
                    <span style={{ fontWeight: 600 }}>Outcome: </span>
                    {row.outcome}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {patternList.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1" style={{ fontWeight: 600 }}>
            <MessageCircle className="w-3.5 h-3.5" aria-hidden />
            Patterns
          </p>
          <ul className="list-disc ml-4 text-gray-800 space-y-0.5">
            {patternList.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <SnippetList variant="fact" title="Facts" items={facts} />
      <SnippetList variant="baseline" title="Base rates" items={rates} />
      <SnippetList variant="recent" title="Recent events" items={recent} />
    </div>
  );
}

type EvidenceItem = { text: string; source_url?: string; confidence?: number };

function _dedupeSnippets(items: EvidenceItem[], max: number): EvidenceItem[] {
  const seen = new Set<string>();
  const out: EvidenceItem[] = [];
  for (const raw of items) {
    const t = normalizeEvidenceSnippet(raw.text || '');
    const key = t.toLowerCase().slice(0, 800);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...raw, text: t });
    if (out.length >= max) break;
  }
  return out;
}

/** Collapse whitespace and heading noise so long web snippets don’t break layout. */
function normalizeEvidenceSnippet(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/\n{2,}/g, '\n').trim();
  t = t.replace(/\n/g, ' ');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

const SNIPPET_PREVIEW_CHARS = 320;

function EvidenceSnippetRow({
  item,
  emphasis = 'fact',
}: {
  item: EvidenceItem;
  emphasis?: 'fact' | 'baseline' | 'recent';
}) {
  const text = item.text || '';
  const [open, setOpen] = useState(false);
  const long = text.length > SNIPPET_PREVIEW_CHARS;

  const preview = long
    ? (() => {
        const slice = text.slice(0, SNIPPET_PREVIEW_CHARS);
        const lastSpace = slice.lastIndexOf(' ');
        const cut = lastSpace > 200 ? slice.slice(0, lastSpace) : slice;
        return `${cut.trim()}…`;
      })()
    : text;

  const rowTone =
    emphasis === 'baseline'
      ? 'border-amber-200/90 bg-white/90 ring-1 ring-amber-100/70'
      : emphasis === 'recent'
        ? 'border-sky-200/85 bg-white/90 ring-1 ring-sky-100/60'
        : 'border-purple-100/90 bg-white/70';

  return (
    <li className={cn('min-w-0 rounded-lg border pl-3 pr-2 py-2 shadow-sm', rowTone)}>
      {emphasis === 'baseline' && (
        <div className="mb-1.5 flex items-center gap-1.5">
          <span
            className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
            aria-hidden
          />
          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-900/90">Baseline</span>
        </div>
      )}
      {!open && (
        <div
          className={cn(
            'text-gray-800 text-sm leading-relaxed break-words [overflow-wrap:anywhere]',
            long && 'line-clamp-4',
          )}
        >
          {long ? preview : text}
        </div>
      )}
      {open && long && (
        <div className="max-h-56 overflow-y-auto rounded-md border border-gray-100 bg-gray-50/90 p-2.5 text-xs text-gray-800 leading-relaxed break-words [overflow-wrap:anywhere]">
          {text}
        </div>
      )}
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 text-[11px] text-purple-700 hover:text-purple-900 hover:underline"
          style={{ fontWeight: 600 }}
        >
          {open ? 'Show less' : 'Show full text'}
        </button>
      )}
      {item.source_url && (
        <p className="mt-1.5 text-[10px] text-gray-500 break-all">
          source:{' '}
          <a
            href={item.source_url}
            target="_blank"
            rel="noreferrer"
            className="text-indigo-700 hover:underline"
          >
            {item.source_url}
          </a>
        </p>
      )}
    </li>
  );
}

function SnippetList({
  title,
  items,
  variant = 'fact',
}: {
  title: string;
  items: EvidenceItem[];
  variant?: 'fact' | 'baseline' | 'recent';
}) {
  // Recent events bundle profile + shadow + decision history; show more than facts/base_rates.
  const deduped = _dedupeSnippets(items, variant === 'recent' ? 14 : 5);

  const shell =
    variant === 'baseline'
      ? 'rounded-xl border-l-[5px] border-amber-400/90 bg-gradient-to-br from-amber-50/95 to-white/80 pl-3 pr-2.5 py-3 shadow-sm ring-1 ring-amber-100/90'
      : variant === 'recent'
        ? 'rounded-xl border-l-[5px] border-sky-400/85 bg-gradient-to-br from-sky-50/80 to-white/80 pl-3 pr-2.5 py-3 shadow-sm ring-1 ring-sky-100/80'
        : 'min-w-0';

  return (
    <div className={cn('min-w-0', shell)}>
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <p
          className={cn(
            'text-xs mb-0',
            variant === 'baseline' && 'text-amber-950',
            variant === 'recent' && 'text-sky-950',
            variant === 'fact' && 'text-gray-500',
          )}
          style={{ fontWeight: 700 }}
        >
          {title}
        </p>
        {variant === 'baseline' && (
          <span
            className="inline-flex items-center rounded-md bg-amber-200/95 text-amber-950 border border-amber-400/50 px-2 py-0.5 text-[10px] uppercase tracking-wide"
            style={{ fontWeight: 800 }}
          >
            Baseline
          </span>
        )}
        {variant === 'recent' && (
          <span
            className="inline-flex items-center rounded-md bg-sky-200/90 text-sky-950 border border-sky-300/60 px-2 py-0.5 text-[10px] uppercase tracking-wide"
            style={{ fontWeight: 700 }}
          >
            Live / recent
          </span>
        )}
      </div>
      {variant === 'baseline' && (
        <p className="text-[10px] text-amber-950/85 mb-2 leading-relaxed">
          Each line below is a baseline-style reference (prior or external rate), not a personal memory pattern.
        </p>
      )}
      {deduped.length === 0 ? (
        <p className="text-xs text-gray-500 italic">No items retrieved for this section in the current run.</p>
      ) : (
        <ul className="space-y-2">
          {deduped.map((t, i) => (
            <EvidenceSnippetRow key={i} item={t} emphasis={variant} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReflectionBlock({ report }: { report: DecisionReport }) {
  const r = report.reflection;
  return (
    <div className="space-y-3 text-sm text-gray-800">
      <BulletIconList
        icon={AlertTriangle}
        title="Possible errors"
        items={r.possibleErrors}
      />
      <BulletIconList
        icon={ListChecks}
        title="Uncertainty"
        items={r.uncertaintySources}
      />
      <BulletIconList icon={MessageCircle} title="Gaps" items={r.informationGaps} />
      {r.selfImprovement && (
        <p className="text-sm leading-relaxed border-t border-gray-200/60 pt-2 mt-2">
          <span className="text-gray-500" style={{ fontWeight: 600 }}>Learning signal: </span>
          {r.selfImprovement}
        </p>
      )}
    </div>
  );
}

function BulletIconList({
  icon: Icon,
  title,
  items,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  items?: string[];
}) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1 flex items-center gap-1" style={{ fontWeight: 600 }}>
        <Icon className="w-3.5 h-3.5" aria-hidden />
        {title}
      </p>
      <ul className="list-disc ml-4 space-y-0.5">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
