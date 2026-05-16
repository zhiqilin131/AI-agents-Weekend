import { useEffect, useRef, useState } from 'react';
import { ModelSelector } from '../../features/models/ModelSelector';
import { useSlimeModelCatalog } from '../../features/models/useSlimeModelCatalog';
import { apiFetch } from '../../utils/apiFetch';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import { DecisionReportPanel } from './DecisionReportPanel';
import { MainNavButtons } from './MainNavButtons';
import { ModePill } from './ModePill';
import { ThreadActionDock } from './shadow/ThreadActionDock';
import type { PendingAction } from './shadow/pendingActionTypes';
import { unlockSlimeAudioContext } from '../../utils/slimeAudioContext';

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export function UnifiedChat() {
  const slimeModels = useSlimeModelCatalog();
  const [modelOptionId, setModelOptionId] = useState('');
  useEffect(() => {
    if (slimeModels.ready && slimeModels.defaultModel && !modelOptionId) {
      setModelOptionId(slimeModels.defaultModel);
    }
  }, [slimeModels.ready, slimeModels.defaultModel, modelOptionId]);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [mode, setMode] = useState('normal');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [decisionTrace, setDecisionTrace] = useState<Record<string, unknown> | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingAction]);

  const callUnified = async (payload: Record<string, unknown>) => {
    if (payload.user_action === 'generate_decision_report') {
      unlockSlimeAudioContext();
    }
    const res = await apiFetch('/api/chat/unified', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        thread_id: threadId,
        mode,
        ...payload,
        ...(modelOptionId ? { model_option_id: modelOptionId } : {}),
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as {
      thread_id: string;
      mode: string;
      suggestion: { type: string; title: string; message: string } | null;
      pending_action?: PendingAction | null;
      decision_trace: Record<string, unknown> | null;
      messages: Message[];
    };
    setThreadId(data.thread_id);
    setMode(data.mode);
    if (data.pending_action && typeof data.pending_action === 'object') {
      setPendingAction(data.pending_action);
    } else if (data.suggestion?.type) {
      setPendingAction({
        id: `unified-${Date.now()}`,
        type: data.suggestion.type as PendingAction['type'],
        title: data.suggestion.title,
        message: data.suggestion.message,
        blocks: data.suggestion.type === 'decision_report' ? ['generate_decision_report'] : ['send_message'],
        payload: {},
      });
    } else {
      setPendingAction(null);
    }
    setMessages(data.messages || []);
    if (data.decision_trace) {
      setDecisionTrace(data.decision_trace);
      setReportOpen(true);
    }
  };

  const sendMessage = async (text: string) => {
    setSending(true);
    try {
      await callUnified({ message: text, user_action: 'send_message' });
    } finally {
      setSending(false);
    }
  };

  const hasClarification = pendingAction?.type === 'clarification';

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <MainNavButtons />
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl text-gray-900" style={{ fontWeight: 700 }}>
            Foresight-<span className="text-purple-600">X</span>
          </h1>
          <ModePill mode={mode} />
        </div>
        <div className="rounded-[28px] border border-white/90 bg-white/65 p-4 shadow-[0_16px_42px_rgba(99,102,241,0.09)] backdrop-blur-md">
          <div className="min-h-[58vh] max-h-[66vh] overflow-y-auto px-1 py-3">
            <ChatMessageList messages={messages} />
            <div ref={bottomRef} />
          </div>
          <div className="sticky bottom-0 space-y-3 border-t border-gray-200/80 bg-white/35 pt-3 backdrop-blur-sm">
            <ThreadActionDock
              pendingAction={pendingAction}
              disabled={sending || hasClarification}
              onClarifySkip={() => void callUnified({ user_action: 'send_message', message: '' })}
              onClarifyAnswer={() => {}}
              onGenerateDecisionReport={() =>
                void callUnified({
                  user_action: 'generate_decision_report',
                  message: messages.filter((m) => m.role === 'user').slice(-1)[0]?.content || '',
                })
              }
              onDismissSuggestion={() => void callUnified({ user_action: 'dismiss_suggestion' })}
              onEnterRoleMode={() => void callUnified({ user_action: 'enter_role_mode' })}
            />
            <div className="px-1">
              <ModelSelector
                feature="shadow_chat"
                selectedModelId={modelOptionId || slimeModels.defaultModel}
                onChange={setModelOptionId}
                models={slimeModels.models}
                selectorEnabled={slimeModels.selectorEnabled}
                showCostPreview
                variant="compact"
                elevated={false}
                label="Slime model"
                hint="Unified chat uses your default tier until you change it here."
                disabled={sending}
              />
            </div>
            <ChatInput disabled={sending || hasClarification} onSend={(t) => void sendMessage(t)} />
          </div>
        </div>
      </div>
      <DecisionReportPanel
        trace={decisionTrace}
        open={reportOpen}
        onClose={() => {
          setReportOpen(false);
          setMode('normal');
          void callUnified({ user_action: 'close_decision_report' });
        }}
      />
    </div>
  );
}
