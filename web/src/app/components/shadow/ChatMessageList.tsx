import type { ShadowMessage } from './types';
import { BuddyTooltip } from '../../../features/slime/BuddyTooltip';
import { DecisionReportArtifactCard, type ArtifactStatus } from './DecisionReportArtifactCard';
import { ChatMessageBody } from './ChatMessageBody';

const SUGGESTION_CHIPS = [
  'Help me decide something concrete',
  'I want to reflect on a situation',
  'Plan my next step',
  'Just feeling chatty today',
] as const;

export function ChatMessageList({
  messages,
  onOpenReportArtifact,
  onReviseArtifact,
  onArtifactExecutionCalendar,
  onSuggestionChip,
}: {
  messages: ShadowMessage[];
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
              <BuddyTooltip key={label} content={`Insert this starter into the composer: “${label}”.`}>
                <button
                  type="button"
                  disabled={!onSuggestionChip}
                  onClick={() => onSuggestionChip?.(label)}
                  className="rounded-full border border-indigo-200/90 bg-white/90 px-3 py-1.5 text-xs font-medium text-indigo-900 shadow-sm hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {label}
                </button>
              </BuddyTooltip>
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
              className={`max-w-[80%] rounded-2xl px-4 py-3.5 shadow-sm ${
                m.role === 'user'
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-[15px] leading-relaxed text-white'
                  : 'border border-gray-200/90 bg-white/95 font-sans text-[15px] leading-[1.65] tracking-[0.01em] text-gray-800 antialiased'
              }`}
            >
              <ChatMessageBody content={m.content} role={m.role} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
