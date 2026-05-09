import type { ShadowMessage } from './types';
import { DecisionReportArtifactCard, type ArtifactStatus } from './DecisionReportArtifactCard';

function formatMemoryEventAt(iso: string): string {
  const t = (iso || '').trim();
  if (!t) return '';
  const d = Date.parse(t);
  if (Number.isNaN(d)) return t.slice(0, 16);
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const SUGGESTION_CHIPS = [
  'Help me decide something concrete',
  'I want to reflect on a situation',
  'Plan my next step',
  'Just feeling chatty today',
] as const;

export function ChatMessageList({
  messages,
  memoryLog = [],
  onOpenReportArtifact,
  onReviseArtifact,
  onArtifactExecutionCalendar,
  onSuggestionChip,
}: {
  messages: ShadowMessage[];
  /** Thread `memory_events` (e.g. profile saves) — rendered in-chat after messages */
  memoryLog?: Array<{ kind: string; items: string[]; at: string }>;
  onOpenReportArtifact: (decisionId: string) => void;
  onReviseArtifact: (decisionId: string) => void;
  onArtifactExecutionCalendar: (decisionId: string) => void;
  onSuggestionChip?: (text: string) => void;
}) {
  if (!messages.length) {
    return (
      <div className="flex min-h-[45vh] items-center justify-center">
        <div className="text-center px-2">
          <p className="text-xl text-gray-900 font-semibold">What are we thinking through today?</p>
          <p className="mt-2 text-sm text-gray-500">Tap a starter or type below — no clarification until you send a message.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {SUGGESTION_CHIPS.map((label) => (
              <button
                key={label}
                type="button"
                disabled={!onSuggestionChip}
                onClick={() => onSuggestionChip?.(label)}
                className="rounded-full border border-indigo-200/90 bg-white/90 px-3 py-1.5 text-xs font-medium text-indigo-900 shadow-sm hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {messages.map((m) => {
        const meta = m.metadata;
        const isArtifact = meta && String(meta.type) === 'decision_report_artifact';
        if (m.role === 'assistant' && isArtifact) {
          const decisionId = String(meta?.decision_id ?? '');
          const title = String(meta?.title ?? 'Decision Report');
          const summary = String(meta?.summary ?? '');
          const st = String(meta?.status ?? 'complete') as ArtifactStatus;
          const createdAt = meta?.created_at != null ? String(meta.created_at) : undefined;
          if (!decisionId) {
            return (
              <div key={m.id} className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900">
                  Report artifact missing decision id.
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className="flex justify-start">
              <DecisionReportArtifactCard
                decisionId={decisionId}
                title={title}
                summary={summary}
                status={st === 'generating' || st === 'error' ? st : 'complete'}
                createdAt={createdAt}
                onOpenReport={() => onOpenReportArtifact(decisionId)}
                onReviseChat={() => onReviseArtifact(decisionId)}
                onOpenExecutionCalendar={() => onArtifactExecutionCalendar(decisionId)}
              />
            </div>
          );
        }
        return (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm'
                  : 'border border-gray-200 bg-white/90 text-gray-900 shadow-sm'
              }`}
            >
              <span className="whitespace-pre-wrap">{m.content || '\u00a0'}</span>
            </div>
          </div>
        );
      })}
      {memoryLog
        .filter((ev) => ev.kind === 'profile_update' && Array.isArray(ev.items) && ev.items.length > 0)
        .map((ev, idx) => (
          <div key={`mem-${ev.at}-${idx}`} className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl border border-emerald-200/90 bg-emerald-50/95 px-4 py-2.5 text-sm shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Saved to profile memory</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[13px] leading-snug text-emerald-950">
                {ev.items.slice(0, 6).map((line, i) => (
                  <li key={`${line}-${i}`}>{line}</li>
                ))}
              </ul>
              {ev.at ? (
                <p className="mt-1.5 text-[10px] text-emerald-800/75">{formatMemoryEventAt(ev.at)}</p>
              ) : null}
            </div>
          </div>
        ))}
    </div>
  );
}
