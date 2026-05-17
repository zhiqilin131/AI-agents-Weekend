import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { VoiceRecorderTranscribeButton } from '../VoiceRecorderTranscribeButton';
import { ModelSelector } from '../../../features/models/ModelSelector';
import { useSlimeModelCatalog } from '../../../features/models/useSlimeModelCatalog';
import { apiFetch } from '../../../utils/apiFetch';
import { MarkdownContent } from '../MarkdownContent';
import { cn } from '../ui/utils';

export type CoachMessage = { role: 'user' | 'assistant'; content: string };

/** Snapshot of the option card the user opened — keeps coach aligned with what they see in the report. */
export type CoachOptionContext = {
  id: string;
  name: string;
  description?: string;
  keyAssumptions?: string[];
  costOfReversal?: string;
  isRecommended?: boolean;
  importanceRank?: number;
  importanceTier?: string;
  tradeoffScores?: Record<string, number>;
};

type OptionCoachPanelProps = {
  open: boolean;
  option: CoachOptionContext | null;
  decisionId: string;
  onClose: () => void;
};

function toOptionContextPayload(option: CoachOptionContext) {
  return {
    description: option.description?.trim() || undefined,
    key_assumptions: option.keyAssumptions?.filter(Boolean),
    cost_of_reversal: option.costOfReversal?.trim() || undefined,
    is_recommended: option.isRecommended,
    importance_rank: option.importanceRank,
    importance_tier: option.importanceTier,
    tradeoff_scores: option.tradeoffScores,
  };
}

function resolveModelId(
  candidate: string,
  models: { id: string }[],
  fallback: string,
): string {
  const c = candidate.trim();
  if (c && models.some((m) => m.id === c)) return c;
  const fb = fallback.trim();
  if (fb && models.some((m) => m.id === fb)) return fb;
  return models[0]?.id ?? 'little';
}

export function OptionCoachPanel({ open, option, decisionId, onClose }: OptionCoachPanelProps) {
  const slimeModels = useSlimeModelCatalog();
  const [coachModelId, setCoachModelId] = useState('');
  const [question, setQuestion] = useState('');
  const [threads, setThreads] = useState<Record<string, CoachMessage[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const optionId = option?.id ?? '';
  const activeThread: CoachMessage[] = optionId ? (threads[optionId] ?? []) : [];

  useEffect(() => {
    if (!open || !slimeModels.ready) return;
    setCoachModelId((prev) =>
      resolveModelId(prev, slimeModels.models, slimeModels.defaultModel),
    );
  }, [open, slimeModels.ready, slimeModels.defaultModel, slimeModels.models]);

  useEffect(() => {
    if (!open || !optionId || !slimeModels.ready) return;
    setCoachModelId((prev) =>
      resolveModelId(prev, slimeModels.models, slimeModels.defaultModel),
    );
  }, [open, optionId, slimeModels.ready, slimeModels.defaultModel, slimeModels.models]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeThread.length, busy]);

  const askCoach = useCallback(
    async (rawQuestion: string) => {
      const q = rawQuestion.trim();
      if (!optionId || !decisionId || !q || busy) return;

      const modelId = resolveModelId(coachModelId, slimeModels.models, slimeModels.defaultModel);
      const history = activeThread;
      const nextThread = [...history, { role: 'user' as const, content: q }];
      setThreads((prev) => ({ ...prev, [optionId]: nextThread }));
      setQuestion('');
      setBusy(true);
      setError(null);

      try {
        const res = await apiFetch('/api/option-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision_id: decisionId,
            option_id: optionId,
            question: q,
            chat_history: history,
            model_option_id: modelId,
            option_context: option ? toOptionContextPayload(option) : undefined,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { answer?: string };
        const ans = (data.answer ?? '').trim();
        setThreads((prev) => ({
          ...prev,
          [optionId]: [...(prev[optionId] ?? nextThread), { role: 'assistant', content: ans }],
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to get follow-up guidance');
      } finally {
        setBusy(false);
      }
    },
    [activeThread, busy, coachModelId, decisionId, option, optionId, slimeModels.defaultModel, slimeModels.models],
  );

  const onVoiceTranscript = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setQuestion((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t));
    },
    [],
  );

  const activeModel =
    slimeModels.models.find((m) => m.id === coachModelId) ??
    slimeModels.models.find((m) => m.id === slimeModels.defaultModel);

  return (
    <AnimatePresence>
      {open && option ? (
        <>
          <motion.button
            type="button"
            aria-label="Close option coach"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[220] bg-slate-950/25 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-labelledby="option-coach-title"
            initial={{ opacity: 0, x: 28, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="fixed bottom-4 right-4 top-auto z-[221] flex h-[min(88vh,52rem)] w-[min(92vw,22rem)] min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/80 bg-gradient-to-b from-white/98 via-violet-50/40 to-indigo-50/55 shadow-[0_28px_80px_rgba(79,70,229,0.22)] backdrop-blur-xl sm:w-[min(92vw,26rem)]"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(255,255,255,0.95),transparent_42%),radial-gradient(circle_at_88%_8%,rgba(167,139,250,0.22),transparent_38%)]" />

            <header className="relative z-10 flex items-start justify-between gap-3 border-b border-violet-100/80 px-4 py-3.5">
              <div className="min-w-0">
                <p
                  id="option-coach-title"
                  className="text-[10px] font-bold uppercase tracking-[0.28em] text-violet-600/90"
                >
                  Option coach
                </p>
                <p className="mt-1 truncate text-base font-semibold text-slate-950">{option.name}</p>
                {activeModel ? (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Using <span className="font-semibold text-violet-800">{activeModel.display_name}</span>
                    {activeModel.engine ? (
                      <span className="text-slate-400"> · {activeModel.engine}</span>
                    ) : null}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/90 bg-white/80 text-slate-500 shadow-sm transition hover:bg-white hover:text-slate-800"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="relative z-10 shrink-0 border-b border-violet-100/70 px-3 py-2.5">
              <ModelSelector
                key={`coach-model-${option.id}`}
                feature="shadow_chat"
                selectedModelId={resolveModelId(
                  coachModelId,
                  slimeModels.models,
                  slimeModels.defaultModel,
                )}
                onChange={(id) => setCoachModelId(id)}
                models={slimeModels.models}
                selectorEnabled={slimeModels.selectorEnabled}
                showCostPreview={false}
                variant="compact"
                elevated={false}
                hideCompactHeader
                compactSelectAriaLabel="Slime model for option coach"
                disabled={busy}
                className="w-full"
              />
            </div>

            <div className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
              <div className="space-y-3">
                <div className="rounded-2xl border border-violet-200/80 bg-white/75 px-3 py-2.5 text-left shadow-sm">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-violet-600/90">About this option</p>
                  {option.description?.trim() ? (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-slate-700">{option.description}</p>
                  ) : null}
                  {option.costOfReversal ? (
                    <p className="mt-1.5 text-[11px] text-slate-600">
                      <span className="font-semibold text-slate-800">Reversal cost:</span> {option.costOfReversal}
                    </p>
                  ) : null}
                  {option.keyAssumptions && option.keyAssumptions.length > 0 ? (
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-slate-600">
                      {option.keyAssumptions.slice(0, 4).map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  ) : null}
                  {option.tradeoffScores && Object.keys(option.tradeoffScores).length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.entries(option.tradeoffScores).map(([k, v]) => (
                        <span
                          key={k}
                          className="rounded-full border border-indigo-100 bg-indigo-50/90 px-2 py-0.5 text-[10px] font-semibold text-indigo-900"
                        >
                          {k} {v}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {option.isRecommended ? (
                    <p className="mt-2 text-[10px] font-semibold text-amber-800">★ Recommended in this report</p>
                  ) : null}
                </div>

                {activeThread.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-violet-200/80 bg-white/50 px-3 py-4 text-center">
                    <MessageCircle className="mx-auto h-5 w-5 text-violet-400" aria-hidden />
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">
                      Ask how to execute <span className="font-medium text-slate-800">{option.name}</span> — scripts,
                      first steps, or handling pushback.
                    </p>
                  </div>
                ) : (
                  activeThread.map((m, i) => (
                    <div
                      key={`${m.role}-${i}`}
                      className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
                    >
                      <div
                        className={cn(
                          'max-w-[92%] rounded-2xl px-3 py-2.5 text-[13px] leading-relaxed shadow-sm',
                          m.role === 'user'
                            ? 'rounded-br-md bg-gradient-to-br from-violet-600 to-indigo-600 text-white'
                            : 'rounded-bl-md border border-white/90 bg-white/90 text-slate-800',
                        )}
                      >
                        <p className="mb-1 text-[9px] font-bold uppercase tracking-wider opacity-70">
                          {m.role === 'user' ? 'You' : 'Coach'}
                        </p>
                        {m.role === 'user' ? (
                          <p className="whitespace-pre-wrap">{m.content}</p>
                        ) : (
                          <MarkdownContent
                            content={m.content}
                            className="text-[13px] [&_p]:text-[13px] [&_p]:text-slate-800"
                          />
                        )}
                      </div>
                    </div>
                  ))
                )}
                {busy ? (
                  <div className="flex items-center gap-2 text-xs text-violet-700">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Thinking…
                  </div>
                ) : null}
                <div ref={threadEndRef} />
              </div>
            </div>

            <footer className="relative z-10 shrink-0 border-t border-violet-100/80 bg-white/55 px-3 py-3 backdrop-blur-md">
              {error ? (
                <p className="mb-2 rounded-xl border border-red-200/80 bg-red-50/90 px-2.5 py-2 text-[11px] text-red-800">
                  {error}
                </p>
              ) : null}
              <div className="flex items-end gap-2">
                <VoiceRecorderTranscribeButton
                  compact
                  disabled={busy}
                  onTranscript={onVoiceTranscript}
                  className="shrink-0"
                />
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void askCoach(question);
                    }
                  }}
                  placeholder="Ask specifics — message template, first 3 steps, if they push back…"
                  rows={2}
                  disabled={busy}
                  className="min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-violet-100/90 bg-white/95 px-3 py-2 text-[13px] text-slate-900 shadow-inner placeholder:text-slate-400 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-200/80"
                />
                <button
                  type="button"
                  onClick={() => void askCoach(question)}
                  disabled={!question.trim() || busy}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-[0_10px_28px_rgba(99,102,241,0.35)] transition hover:brightness-105 disabled:opacity-40"
                  aria-label="Send question"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
                <Sparkles className="h-3 w-3 text-violet-500" aria-hidden />
                Enter to send · mic adds to your draft
              </p>
            </footer>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
