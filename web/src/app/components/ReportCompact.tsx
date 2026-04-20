import { useState, type ComponentType } from 'react';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Clock,
  Gauge,
  Layers,
  ListChecks,
  MessageCircle,
  Sparkles,
  Star,
  Undo2,
} from 'lucide-react';
import type { DecisionReport } from '../model';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './ui/accordion';
import { SimulatedFuturesPanel } from './SimulatedFuturesPanel';
import { TradeoffsRadarChart } from './TradeoffsRadarChart';
import { TypewriterText } from './TypewriterText';
import { cn } from './ui/utils';
import { apiUrl } from '../../utils/apiOrigin';

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
}

type CoachMessage = { role: 'user' | 'assistant'; content: string };

export function ReportCompact({ report, fullTrace, tier3Profile, isStreaming }: ReportCompactProps) {
  const futures = (fullTrace?.futures as TraceFuture[]) ?? [];
  const evidence = fullTrace?.evidence as TraceEvidence | undefined;
  const hasRec = Boolean(report.recommendation.reasoning || report.recommendation.chosenOption);
  const chosenOptionId = report.recommendation.chosenOption?.trim() ?? '';
  const optionTitleById = new Map(report.options.map((o) => [o.id, o.name]));
  const decisionId = typeof fullTrace?.decision_id === 'string' ? fullTrace.decision_id : '';
  const [coachOption, setCoachOption] = useState<{ id: string; name: string } | null>(null);
  const [coachQuestion, setCoachQuestion] = useState('');
  const [coachThreads, setCoachThreads] = useState<Record<string, CoachMessage[]>>({});
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const activeThread: CoachMessage[] = coachOption ? (coachThreads[coachOption.id] ?? []) : [];

  const askOptionCoach = async () => {
    if (!coachOption || !decisionId || !coachQuestion.trim() || coachBusy) return;
    const optionId = coachOption.id;
    const question = coachQuestion.trim();
    const history = activeThread;
    const nextThread = [...history, { role: 'user' as const, content: question }];
    setCoachThreads((prev) => ({ ...prev, [optionId]: nextThread }));
    setCoachQuestion('');
    setCoachBusy(true);
    setCoachError(null);
    try {
      const res = await fetch(apiUrl('/api/option-chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision_id: decisionId,
          option_id: optionId,
          question,
          chat_history: history,
        }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = (await res.json()) as { answer?: string };
      const ans = (data.answer ?? '').trim();
      setCoachThreads((prev) => ({
        ...prev,
        [optionId]: [...(prev[optionId] ?? nextThread), { role: 'assistant', content: ans }],
      }));
    } catch (e) {
      setCoachError(e instanceof Error ? e.message : 'Failed to get follow-up guidance');
    } finally {
      setCoachBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Hero: recommendation first — page scroll only (no nested scroll area) */}
      <section className="rounded-[24px] border border-white/90 bg-gradient-to-br from-white/80 to-purple-50/50 p-6 shadow-[0_8px_40px_rgba(0,0,0,0.06)] backdrop-blur-md">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-md shrink-0">
            <Sparkles className="w-5 h-5 text-white" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wider text-purple-700 mb-1" style={{ fontWeight: 700 }}>
              Recommendation
            </p>
            <p className="text-lg text-gray-900 leading-snug" style={{ fontWeight: 700 }}>
              {report.recommendation.chosenOptionName ||
                optionTitleById.get(chosenOptionId) ||
                report.recommendation.chosenOption ||
                '…'}
            </p>
          </div>
        </div>
        {hasRec &&
          (isStreaming ? (
            <p
              className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap"
              style={{ fontWeight: 400, lineHeight: 1.75 }}
            >
              {report.recommendation.reasoning}
            </p>
          ) : (
            <TypewriterText
              text={report.recommendation.reasoning}
              as="p"
              className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap"
              enabled={Boolean(report.recommendation.reasoning)}
            />
          ))}
        {report.actions.length > 0 && (
          <ul className="mt-4 space-y-2">
            {report.actions.slice(0, 5).map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
                <span>
                  {a.text}
                  {a.deadline && (
                    <span className="text-gray-500 text-xs ml-1">({a.deadline})</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

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

      {report.tradeoffs && report.tradeoffs.rows.length > 0 && (
        <section className="rounded-2xl bg-white/60 border border-white/80 p-4 shadow-sm">
          <h3 className="text-sm text-gray-900 mb-2 flex items-center gap-2" style={{ fontWeight: 700 }}>
            <Layers className="w-4 h-4 text-purple-600" aria-hidden />
            Trade-offs (visual)
          </h3>
          <TradeoffsRadarChart tradeoffs={report.tradeoffs} />
        </section>
      )}

      {tier3Profile?.profile && (
        <Tier3ProfileBlock tier3Profile={tier3Profile} fullTrace={fullTrace} />
      )}

      <Accordion type="multiple" defaultValue={['situation', 'options']} className="rounded-2xl border border-white/80 bg-white/40 px-2">
        <AccordionItem value="situation">
          <AccordionTrigger className="text-sm" style={{ fontWeight: 600 }}>
            Situation & goals
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{report.situation || '…'}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="options">
          <AccordionTrigger className="text-sm" style={{ fontWeight: 600 }}>
            Options ({report.options.length})
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4">
              {report.options.map((o) => {
                const tier = o.importanceTier ?? 'medium';
                const rank = o.importanceRank ?? 0;
                const rec = Boolean(o.isRecommended);
                return (
                  <div
                    key={o.id}
                    className={cn('rounded-xl border p-3 space-y-3 shadow-sm', optionTierSurface(tier))}
                  >
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
                        onClick={() => {
                          setCoachOption({ id: o.id, name: o.name });
                          setCoachError(null);
                        }}
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
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="evidence">
          <AccordionTrigger className="text-sm" style={{ fontWeight: 600 }}>
            Memory & evidence
          </AccordionTrigger>
          <AccordionContent>
            <EvidenceBlock
              evidence={evidence}
              patterns={report.insights.memoryPatterns}
              memoryTrace={fullTrace?.memory as TraceMemoryBlock | undefined}
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

      {coachOption && (
        <div className="fixed bottom-5 right-5 z-[75] w-[min(92vw,28rem)] rounded-2xl border border-purple-200/80 bg-white/95 shadow-2xl shadow-purple-500/20 backdrop-blur-sm">
          <div className="px-4 py-3 border-b border-purple-100/80 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-purple-800 font-bold">Option Coach</p>
              <p className="text-sm text-gray-800 truncate">{coachOption.name}</p>
            </div>
            <button
              type="button"
              onClick={() => setCoachOption(null)}
              className="text-xs text-gray-500 hover:text-gray-800"
            >
              Close
            </button>
          </div>
          <div className="p-4 space-y-3">
            <div className="max-h-52 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2 space-y-2">
              {activeThread.length === 0 ? (
                <p className="text-xs text-gray-500">
                  Ask follow-up questions about this option. Context is retained in this thread.
                </p>
              ) : (
                activeThread.map((m, i) => (
                  <div key={`${m.role}-${i}`} className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500 font-bold">
                      {m.role === 'user' ? 'You' : 'Coach'}
                    </p>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{m.content}</p>
                  </div>
                ))
              )}
            </div>
            <textarea
              value={coachQuestion}
              onChange={(e) => setCoachQuestion(e.target.value)}
              placeholder="Ask specifics, e.g. exact message template, first 3 steps, what to say if they push back..."
              rows={3}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white"
            />
            <button
              type="button"
              onClick={() => void askOptionCoach()}
              disabled={!coachQuestion.trim() || coachBusy}
              className="px-4 py-2 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-semibold disabled:opacity-40"
            >
              {coachBusy ? 'Thinking…' : 'Ask'}
            </button>
            {coachError && <p className="text-xs text-red-700 whitespace-pre-wrap">{coachError}</p>}
          </div>
        </div>
      )}
    </div>
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
    <section className="rounded-2xl bg-white/70 border border-white/85 p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm text-gray-900 flex items-center gap-2" style={{ fontWeight: 700 }}>
            <Brain className="w-4 h-4 text-violet-600" aria-hidden />
            Tier 3 semantic profile
          </h3>
          <p className="text-[11px] text-gray-600 mt-1">
            Values/risk/themes profile from `cursor_tier3_profile_prompt.md`, loaded for recommender.
          </p>
        </div>
        <span
          className={cn(
            'text-[10px] px-2 py-1 rounded-full border',
            used
              ? 'bg-emerald-100 text-emerald-900 border-emerald-200'
              : 'bg-amber-100 text-amber-900 border-amber-200',
          )}
          style={{ fontWeight: 700 }}
        >
          {used ? 'Profile actively used' : 'Profile weakly weighted'}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MiniMetric label="Confidence" value={confidence.toFixed(2)} />
        <MiniMetric label="Threshold" value={threshold.toFixed(2)} />
        <MiniMetric label="Risk posture" value={p.risk_posture || 'unknown'} />
        <MiniMetric label="Decisions summarized" value={String(p.n_decisions_summarized ?? 0)} />
      </div>

      <div className="text-[11px] text-gray-600 leading-relaxed rounded-md bg-violet-50/80 border border-violet-100 px-2.5 py-2">
        In this run, profile fields injected into `user_state` for downstream modules: {injectedCount}
        {(userState.profile_values?.length ?? 0) > 0 ? ` · values ${userState.profile_values?.length ?? 0}` : ''}
        {(userState.profile_priorities?.length ?? 0) > 0 ? ` · priorities ${userState.profile_priorities?.length ?? 0}` : ''}
        {(userState.profile_constraints?.length ?? 0) > 0 ? ` · constraints ${userState.profile_constraints?.length ?? 0}` : ''}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <StringList title="Values" items={p.values ?? []} />
        <StringList title="Recurring themes" items={p.recurring_themes ?? []} />
        <StringList title="Current goals" items={p.current_goals ?? []} />
        <StringList title="Known constraints" items={p.known_constraints ?? []} />
      </div>

      <p className="text-[10px] text-gray-500">
        Source: {tier3Profile.source || 'unknown'}{p.last_updated ? ` · last updated ${p.last_updated}` : ''}
      </p>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/90 border border-gray-200/80 px-2.5 py-2">
      <p className="text-[10px] text-gray-500 uppercase" style={{ fontWeight: 600 }}>
        {label}
      </p>
      <p className="text-xs text-gray-900 truncate" style={{ fontWeight: 700 }}>
        {value}
      </p>
    </div>
  );
}

function StringList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) {
    return (
      <div className="rounded-lg bg-white/80 border border-gray-200/80 px-2.5 py-2">
        <p className="text-[11px] text-gray-500 mb-1" style={{ fontWeight: 700 }}>
          {title}
        </p>
        <p className="text-xs text-gray-400">No signal yet.</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-white/80 border border-gray-200/80 px-2.5 py-2">
      <p className="text-[11px] text-gray-500 mb-1" style={{ fontWeight: 700 }}>
        {title}
      </p>
      <ul className="list-disc ml-4 text-xs text-gray-800 space-y-0.5">
        {items.slice(0, 5).map((x, i) => (
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
          <p className="text-xs text-gray-800 leading-relaxed whitespace-pre-wrap">
            {memoryTrace?.prior_outcomes_summary}
          </p>
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
