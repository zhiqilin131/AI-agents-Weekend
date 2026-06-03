import { useState, type Dispatch, type SetStateAction } from 'react';
import type { ScoringClarifyQuestion } from '../../../utils/featureAudit';
import { apiFetch } from '../../../utils/apiFetch';

interface ScoringClarifyPanelBaseProps {
  questions: ScoringClarifyQuestion[];
  coverage?: number;
  busy?: boolean;
}

interface ScoringClarifyGateProps extends ScoringClarifyPanelBaseProps {
  variant: 'gate';
  onApply: (answers: Record<string, string>) => void;
  onSkip: () => void;
}

interface ScoringClarifyRefineProps extends ScoringClarifyPanelBaseProps {
  variant?: 'refine';
  decisionId: string;
  onRescored?: (trace: Record<string, unknown>) => void;
}

export type ScoringClarifyPanelProps = ScoringClarifyGateProps | ScoringClarifyRefineProps;

function QuestionList({
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
            <p className="mb-2 text-sm leading-snug text-slate-700">{q.prompt}</p>
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

export function ScoringClarifyPanel(props: ScoringClarifyPanelProps) {
  const { questions, coverage, busy: externalBusy } = props;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [internalBusy, setInternalBusy] = useState(false);
  const [error, setError] = useState('');
  const busy = externalBusy ?? internalBusy;

  if (!questions.length) return null;

  const isGate = props.variant === 'gate';
  const title = isGate
    ? 'Ground the ranking before we recommend'
    : 'A few details would sharpen the ranking';
  const subtitle =
    typeof coverage === 'number'
      ? isGate
        ? `${Math.round(coverage * 100)}% of tradeoff features are grounded — MAVT requires more signal before a final rank.`
        : `${Math.round(coverage * 100)}% of tradeoff features are grounded — these answers close the gap.`
      : isGate
        ? 'Critical tradeoff features are still unknown. Short answers improve ranking validity.'
        : 'Some tradeoff features are still unknown. Short answers help ground the score.';

  const submitRefine = async () => {
    if (props.variant === 'gate') return;
    setInternalBusy(true);
    setError('');
    try {
      const res = await apiFetch('/api/run/rescore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision_id: props.decisionId,
          scoring_clarification: answers,
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

  return (
    <section
      className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm"
      data-testid="scoring-clarify-panel"
      data-variant={isGate ? 'gate' : 'refine'}
    >
      <div className="mb-3">
        <h3 className="text-[13px] tracking-tight text-slate-800" style={{ fontWeight: 600 }}>
          {title}
        </h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{subtitle}</p>
      </div>

      <QuestionList questions={questions} answers={answers} setAnswers={setAnswers} />

      {error ? <p className="mt-2 text-[11px] text-rose-600">{error}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || Object.keys(answers).length === 0}
          onClick={() => {
            if (props.variant === 'gate') {
              props.onApply(answers);
            } else {
              void submitRefine();
            }
          }}
          className="rounded-full bg-slate-800 px-4 py-2 text-[12px] text-white transition-opacity disabled:opacity-35 hover:bg-slate-900"
        >
          {busy ? 'Continuing…' : isGate ? 'Continue to recommendation' : 'Apply answers'}
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
