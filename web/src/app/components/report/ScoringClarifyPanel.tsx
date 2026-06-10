import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import type { ElicitationSubmitPayload, ScoringClarifyQuestion } from '../../../utils/featureAudit';
import { AlignmentWarnings } from './AlignmentWarnings';
import { TradeoffMatrix } from './TradeoffMatrix';
import type { FeatureAudit } from '../../../utils/featureAudit';
import { apiFetch } from '../../../utils/apiFetch';

interface ScoringClarifyPanelBaseProps {
  levelQuestions: ScoringClarifyQuestion[];
  comparativeQuestions?: ScoringClarifyQuestion[];
  coverage?: number;
  discrimination?: number;
  audit?: FeatureAudit | null;
  optionNames?: Record<string, string>;
  busy?: boolean;
  initialLevelAnswers?: Record<string, string>;
  initialRankAnswers?: Record<string, string[]>;
  elicitationRound?: number;
  maxElicitationRounds?: number;
  validationErrors?: string[];
}

interface ScoringClarifyGateProps extends ScoringClarifyPanelBaseProps {
  variant: 'gate';
  onApply: (payload: ElicitationSubmitPayload) => void;
  onSkip: () => void;
}

interface ScoringClarifyRefineProps extends ScoringClarifyPanelBaseProps {
  variant?: 'refine';
  decisionId: string;
  onRescored?: (trace: Record<string, unknown>) => void;
}

export type ScoringClarifyPanelProps = ScoringClarifyGateProps | ScoringClarifyRefineProps;

function LevelQuestionList({
  questions,
  answers,
  setAnswers,
}: {
  questions: ScoringClarifyQuestion[];
  answers: Record<string, string>;
  setAnswers: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  return (
    <div className="space-y-2">
      {questions.map((q, index) => {
        const isFirst = index === 0;
        return (
          <div
            key={q.id}
            className={`rounded-xl border px-3 py-2.5 transition-colors ${
              isFirst ? 'border-slate-200/80 bg-slate-50/50' : 'border-slate-100/90 bg-white/80'
            }`}
          >
            {isFirst ? (
              <p className="mb-1.5 text-[9px] uppercase tracking-[0.12em] text-slate-400">
                Most likely to shift ranking
              </p>
            ) : null}
            <p className="mb-2 whitespace-pre-line text-sm leading-snug text-slate-700">{q.prompt}</p>
            <div className="flex flex-wrap gap-1.5">
              {(q.choices?.length ? q.choices : ['low', 'medium', 'high', 'not sure']).map((c) => {
                const selected = answers[q.id] === c;
                return (
                  <button
                    key={`${q.id}-${c}`}
                    type="button"
                    onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: c }))}
                    className={`rounded-full border px-2.5 py-1 text-[11px] transition-all ${
                      selected
                        ? 'border-slate-700 bg-slate-800 text-white shadow-sm'
                        : 'border-slate-200/90 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ComparativeRankBlock({
  question,
  rank,
  onChange,
}: {
  question: ScoringClarifyQuestion;
  rank: string[];
  onChange: (next: string[]) => void;
}) {
  const labels = question.option_labels ?? {};
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...rank];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  return (
    <div className="rounded-xl border border-indigo-100/90 bg-indigo-50/30 px-3 py-2.5">
      <p className="mb-1 text-[9px] uppercase tracking-[0.12em] text-indigo-500">Compare options</p>
      <p className="mb-2 whitespace-pre-line text-sm leading-snug text-slate-700">{question.prompt.split('\n')[0]}</p>
      <ol className="space-y-1">
        {rank.map((oid, idx) => (
          <li
            key={`${question.id}-${oid}`}
            className="flex items-center gap-2 rounded-lg border border-white/80 bg-white/90 px-2 py-1.5"
          >
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[12px] text-slate-800">{labels[oid] ?? oid}</span>
            <div className="flex shrink-0 gap-0.5">
              <button
                type="button"
                aria-label="Move up"
                disabled={idx === 0}
                onClick={() => move(idx, -1)}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Move down"
                disabled={idx === rank.length - 1}
                onClick={() => move(idx, 1)}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ScoringClarifyPanel(props: ScoringClarifyPanelProps) {
  const {
    levelQuestions,
    comparativeQuestions = [],
    coverage,
    discrimination,
    audit,
    optionNames = {},
    busy: externalBusy,
    initialLevelAnswers = {},
    initialRankAnswers = {},
    elicitationRound,
    maxElicitationRounds = 3,
    validationErrors = [],
  } = props;

  const [step, setStep] = useState<'compare' | 'detail'>(comparativeQuestions.length ? 'compare' : 'detail');
  const [levelAnswers, setLevelAnswers] = useState<Record<string, string>>(() => ({ ...initialLevelAnswers }));
  const [rankAnswers, setRankAnswers] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = { ...initialRankAnswers };
    for (const q of comparativeQuestions) {
      if (!init[q.id]?.length) init[q.id] = [...(q.choices ?? [])];
    }
    return init;
  });
  const [internalBusy, setInternalBusy] = useState(false);
  const [error, setError] = useState('');
  const busy = externalBusy ?? internalBusy;

  const hasContent = levelQuestions.length > 0 || comparativeQuestions.length > 0;
  const canSubmit = useMemo(() => {
    const hasRank = comparativeQuestions.every((q) => (rankAnswers[q.id]?.length ?? 0) >= 2);
    const hasLevel = Object.keys(levelAnswers).length > 0;
    if (comparativeQuestions.length && step === 'compare') return hasRank;
    return hasLevel || (comparativeQuestions.length > 0 && hasRank);
  }, [comparativeQuestions, levelAnswers, rankAnswers, step]);

  if (!hasContent) return null;

  const isGate = props.variant === 'gate';
  const title = isGate
    ? 'Ground the ranking before we recommend'
    : 'Sharpen the tradeoff ranking';
  const subtitle =
    typeof coverage === 'number'
      ? `${Math.round(coverage * 100)}% grounded${
          typeof discrimination === 'number' ? ` · ${Math.round(discrimination * 100)}% spread` : ''
        }${
          typeof elicitationRound === 'number'
            ? ` · round ${elicitationRound + 1}/${maxElicitationRounds}`
            : ''
        } — ${step === 'compare' ? 'Step 1: rank options comparatively' : 'Step 2: confirm per-option levels'}`
      : 'Answer a few tradeoff questions so MCDA can differentiate your options.';

  const buildPayload = (): ElicitationSubmitPayload => ({
    scoring_clarification: levelAnswers,
    comparative_answers: rankAnswers,
  });

  const submitRefine = async () => {
    if (props.variant === 'gate') return;
    setInternalBusy(true);
    setError('');
    try {
      const payload = buildPayload();
      const res = await apiFetch('/api/run/rescore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision_id: props.decisionId,
          scoring_clarification: payload.scoring_clarification,
          comparative_answers: payload.comparative_answers,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `Rescore failed (${res.status})`);
      }
      const data = (await res.json()) as { trace?: Record<string, unknown> };
      if (data.trace && props.onRescored) props.onRescored(data.trace);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rescore failed');
    } finally {
      setInternalBusy(false);
    }
  };

  const handlePrimary = () => {
    if (step === 'compare' && levelQuestions.length) {
      setStep('detail');
      return;
    }
    const payload = buildPayload();
    if (props.variant === 'gate') {
      props.onApply(payload);
    } else {
      void submitRefine();
    }
  };

  return (
    <section
      className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm space-y-3"
      data-testid="scoring-clarify-panel"
      data-variant={isGate ? 'gate' : 'refine'}
    >
      <div>
        <h3 className="text-[13px] tracking-tight text-slate-800" style={{ fontWeight: 600 }}>
          {title}
        </h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{subtitle}</p>
      </div>

      {audit ? <TradeoffMatrix audit={audit} optionNames={optionNames} /> : null}
      <AlignmentWarnings report={audit?.alignment_report} />

      {step === 'compare' && comparativeQuestions.length ? (
        <div className="space-y-2">
          {comparativeQuestions.map((q) => (
            <ComparativeRankBlock
              key={q.id}
              question={q}
              rank={rankAnswers[q.id] ?? q.choices ?? []}
              onChange={(next) => setRankAnswers((prev) => ({ ...prev, [q.id]: next }))}
            />
          ))}
        </div>
      ) : (
        <LevelQuestionList questions={levelQuestions} answers={levelAnswers} setAnswers={setLevelAnswers} />
      )}

      {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
      {validationErrors.length ? (
        <p className="text-[11px] text-amber-700">
          Some answers could not be applied: {validationErrors.slice(0, 3).join(', ')}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {step === 'detail' && comparativeQuestions.length ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setStep('compare')}
            className="rounded-full border border-slate-200/90 px-3 py-2 text-[11px] text-slate-600 hover:bg-slate-50"
          >
            Back to ranking
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || !canSubmit}
          onClick={handlePrimary}
          className="rounded-full bg-slate-800 px-4 py-2 text-[12px] text-white transition-opacity disabled:opacity-35 hover:bg-slate-900"
        >
          {busy
            ? 'Continuing…'
            : step === 'compare' && levelQuestions.length
              ? 'Next: per-option details'
              : isGate
                ? 'Continue to recommendation'
                : 'Apply answers'}
        </button>
        {isGate ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => props.onSkip()}
            className="rounded-full border border-slate-200/90 px-3 py-2 text-[11px] text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            Use provisional ranking
          </button>
        ) : null}
      </div>
    </section>
  );
}
