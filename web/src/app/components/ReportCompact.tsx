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
  Wand2,
} from 'lucide-react';
import type { DecisionReport } from '../model';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './ui/accordion';
import { ScenarioOutcomeCard } from './ScenarioOutcomeCard';
import { TradeoffsRadarChart } from './TradeoffsRadarChart';
import { TypewriterText } from './TypewriterText';
import { cn } from './ui/utils';

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
  facts?: Array<{ text: string; confidence?: number }>;
  base_rates?: Array<{ text: string }>;
  recent_events?: Array<{ text: string }>;
}

interface ReportCompactProps {
  report: DecisionReport;
  fullTrace: Record<string, unknown> | null;
  isStreaming?: boolean;
}

export function ReportCompact({ report, fullTrace, isStreaming }: ReportCompactProps) {
  const futures = (fullTrace?.futures as TraceFuture[]) ?? [];
  const evidence = fullTrace?.evidence as TraceEvidence | undefined;
  const hasRec = Boolean(report.recommendation.reasoning || report.recommendation.chosenOption);
  const chosenOptionId = report.recommendation.chosenOption?.trim() ?? '';
  const optionTitleById = new Map(report.options.map((o) => [o.id, o.name]));

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
              {report.recommendation.chosenOption || '…'}
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
            <EvidenceBlock evidence={evidence} patterns={report.insights.memoryPatterns} />
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
              <div className="space-y-4">
                <p className="text-[11px] text-gray-600 leading-relaxed flex gap-2 items-start border-b border-gray-200/50 pb-3">
                  <Wand2 className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" aria-hidden />
                  <span>
                    <span style={{ fontWeight: 700 }}>Agent simulation:</span> below are forward-looking stories for each
                    option—what life could look like if you take that path, with branching outcomes and rough
                    probabilities. This is model-generated foresight, not a guarantee.
                  </span>
                </p>
                {futures.map((f) => {
                  const isChosenFuture = Boolean(chosenOptionId && f.option_id === chosenOptionId);
                  const displayTitle = optionTitleById.get(f.option_id) ?? f.option_id;
                  const scenarios = [...(f.scenarios ?? [])].sort((a, b) => b.probability - a.probability);
                  return (
                    <div
                      key={f.option_id}
                      className="rounded-xl border border-gray-200/70 p-4 bg-white/80 space-y-3"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        {isChosenFuture ? (
                          <Star
                            className="w-5 h-5 shrink-0 mt-0.5 text-amber-500 fill-amber-400"
                            strokeWidth={1.25}
                            aria-label="Same option as recommendation"
                          />
                        ) : (
                          <span className="w-5 shrink-0" aria-hidden />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900 leading-snug" style={{ fontWeight: 700 }}>
                            {displayTitle}
                          </p>
                          <p className="text-[11px] text-gray-500 mt-0.5 font-mono">{f.option_id}</p>
                        </div>
                      </div>
                      <p className="text-xs text-purple-900/90 bg-purple-50/80 border border-purple-100/80 rounded-lg px-2.5 py-1.5 inline-block">
                        <span style={{ fontWeight: 700 }}>Horizon: </span>
                        {f.time_horizon}
                      </p>
                      <div className="space-y-3">
                        {scenarios.map((s) => (
                          <ScenarioOutcomeCard key={`${f.option_id}-${s.label}`} scenario={s} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
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
    </div>
  );
}

function EvidenceBlock({
  evidence,
  patterns,
}: {
  evidence?: TraceEvidence;
  patterns?: string[];
}) {
  const facts = evidence?.facts ?? [];
  const rates = evidence?.base_rates ?? [];
  const recent = evidence?.recent_events ?? [];
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
          <span style={{ fontWeight: 600 }}>Patterns</span> — short labels from similar past decisions in memory (not
          your full chat).
          <span className="mx-1">·</span>
          <span style={{ fontWeight: 600 }}>Facts</span> — static or retrieved reference snippets.
          <span className="mx-1">·</span>
          <span style={{ fontWeight: 600 }}>Base rates</span> (<span className="text-amber-800/95">baseline</span>) — priors /
          heuristic reference rates, including query-aligned web lines.
          <span className="mx-1">·</span>
          <span style={{ fontWeight: 600 }}>Recent</span> — fresher web or event-style snippets. Career demo seeds are
          hidden when your decision type is not career/academic.
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
      </div>
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
      <SnippetList variant="fact" title="Facts" items={facts.map((f) => f.text)} />
      <SnippetList variant="baseline" title="Base rates" items={rates.map((f) => f.text)} />
      <SnippetList variant="recent" title="Recent events" items={recent.map((f) => f.text)} />
    </div>
  );
}

function _dedupeSnippets(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = normalizeEvidenceSnippet(raw);
    const key = t.toLowerCase().slice(0, 800);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
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
  text,
  emphasis = 'fact',
}: {
  text: string;
  emphasis?: 'fact' | 'baseline' | 'recent';
}) {
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
    </li>
  );
}

function SnippetList({
  title,
  items,
  variant = 'fact',
}: {
  title: string;
  items: string[];
  variant?: 'fact' | 'baseline' | 'recent';
}) {
  const deduped = _dedupeSnippets(items, 5);
  if (deduped.length === 0) return null;

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
      <ul className="space-y-2">
        {deduped.map((t, i) => (
          <EvidenceSnippetRow key={i} text={t} emphasis={variant} />
        ))}
      </ul>
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
