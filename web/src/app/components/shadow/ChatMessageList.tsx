import type { ShadowMessage } from './types';
import { DecisionReportArtifactCard, type ArtifactStatus } from './DecisionReportArtifactCard';

export function ChatMessageList({
  messages,
  onOpenReportArtifact,
  onReviseArtifact,
  onArtifactExecutionCalendar,
}: {
  messages: ShadowMessage[];
  onOpenReportArtifact: (decisionId: string) => void;
  onReviseArtifact: (decisionId: string) => void;
  onArtifactExecutionCalendar: (decisionId: string) => void;
}) {
  if (!messages.length) {
    return (
      <div className="flex min-h-[45vh] items-center justify-center">
        <div className="text-center">
          <p className="text-xl text-gray-900 font-semibold">What are we thinking through today?</p>
          <p className="mt-2 text-sm text-gray-500">Help me decide · Reflect on a situation · Plan my next step · Just talk</p>
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
    </div>
  );
}
