import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../utils/apiOrigin';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import { DecisionReportPanel } from './DecisionReportPanel';
import { MainNavButtons } from './MainNavButtons';
import { ModePill } from './ModePill';
import { ModeSuggestionBanner } from './ModeSuggestionBanner';

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type Suggestion = {
  type: 'role_mode' | 'decision_report' | null;
  title: string;
  message: string;
};

export function UnifiedChat() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [mode, setMode] = useState('normal');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [decisionTrace, setDecisionTrace] = useState<Record<string, unknown> | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, suggestion]);

  const callUnified = async (payload: Record<string, unknown>) => {
    const res = await fetch(apiUrl('/api/chat/unified'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId, mode, ...payload }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as {
      thread_id: string;
      mode: string;
      suggestion: Suggestion | null;
      decision_trace: Record<string, unknown> | null;
      messages: Message[];
    };
    setThreadId(data.thread_id);
    setMode(data.mode);
    setSuggestion(data.suggestion);
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <MainNavButtons />
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl text-gray-900" style={{ fontWeight: 700 }}>Foresight-X</h1>
          <ModePill mode={mode} />
        </div>
        <div className="rounded-[28px] border border-white/90 bg-white/65 p-4 shadow-[0_16px_42px_rgba(99,102,241,0.09)] backdrop-blur-md">
          <div className="min-h-[58vh] max-h-[66vh] overflow-y-auto px-1 py-3">
            <ChatMessageList messages={messages} />
            <div ref={bottomRef} />
          </div>
          <div className="sticky bottom-0 space-y-3 border-t border-gray-200/80 bg-white/35 pt-3 backdrop-blur-sm">
            <ModeSuggestionBanner
              suggestion={suggestion}
              onEnterRoleMode={() => void callUnified({ user_action: 'enter_role_mode' })}
              onGenerateDecisionReport={() => void callUnified({ user_action: 'generate_decision_report', message: messages.filter((m) => m.role === 'user').slice(-1)[0]?.content || '' })}
              onContinue={() => setSuggestion(null)}
              onDismiss={() => void callUnified({ user_action: 'dismiss_suggestion' })}
            />
            <ChatInput disabled={sending} onSend={(t) => void sendMessage(t)} />
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

