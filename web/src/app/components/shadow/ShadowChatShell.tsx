import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router';
import { MainNavButtons } from '../MainNavButtons';
import { ClarifyDialog, type ClarifyQuestion } from '../ClarifyDialog';
import { apiUrl } from '../../../utils/apiOrigin';
import { parseSseBlocks } from '../../../utils/parseSse';
import { useDecisionReportStream } from '../../../hooks/useDecisionReportStream';
import { AgentPresence3DPanel } from './AgentPresence3DPanel';
import { ChatMessageList } from './ChatMessageList';
import { ChatSidebar } from './ChatSidebar';
import { DecisionReportStreamingPanel } from './DecisionReportStreamingPanel';
import { DecisionSuggestionCard } from './DecisionSuggestionCard';
import { ProfileUpdateCard } from './ProfileUpdateCard';
import { ShadowChatInput } from './ShadowChatInput';
import type { AgentStatus, ShadowMessage, ShadowSuggestion, ShadowThread } from './types';

export function ShadowChatShell({
  initialThreadId = null,
  initialOpenReportId = null,
}: {
  initialThreadId?: string | null;
  initialOpenReportId?: string | null;
} = {}) {
  const navigate = useNavigate();
  const [threads, setThreads] = useState<ShadowThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ShadowMessage[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [timeline, setTimeline] = useState<string[]>(['Ready']);
  const [suggestion, setSuggestion] = useState<ShadowSuggestion | null>(null);
  const [profileUpdates, setProfileUpdates] = useState<string[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [clarifyPayload, setClarifyPayload] = useState<{ questions: ClarifyQuestion[]; note: string } | null>(null);
  const [clarifyChecking, setClarifyChecking] = useState(false);
  const [pendingClarifyAction, setPendingClarifyAction] = useState<{
    kind: 'chat' | 'report';
    text: string;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const reportStream = useDecisionReportStream();
  const { loadExistingTrace } = reportStream;

  const pushTimeline = (x: string) =>
    setTimeline((s) => {
      if (s[s.length - 1] === x) return s;
      return [...s, x].slice(-6);
    });

  const refreshThreads = async () => {
    const res = await fetch(apiUrl('/api/shadow-chat/threads'));
    if (!res.ok) return;
    const data = (await res.json()) as { threads: ShadowThread[] };
    setThreads(data.threads || []);
  };

  const loadThread = async (id: string) => {
    const res = await fetch(apiUrl(`/api/shadow-chat/threads/${encodeURIComponent(id)}`));
    if (!res.ok) return;
    const data = (await res.json()) as { thread: ShadowThread };
    setActiveThreadId(data.thread.thread_id);
    setMessages(data.thread.messages || []);
    setSuggestion(null);
    setProfileUpdates([]);
  };

  const newChat = async () => {
    const res = await fetch(apiUrl('/api/shadow-chat/threads'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { thread: ShadowThread };
    await refreshThreads();
    await loadThread(data.thread.thread_id);
  };

  useEffect(() => {
    void (async () => {
      await refreshThreads();
    })();
  }, []);

  useEffect(() => {
    if (threads.length > 0 && !activeThreadId) {
      const prefer = initialThreadId && threads.some((t) => t.thread_id === initialThreadId) ? initialThreadId : threads[0].thread_id;
      void loadThread(prefer);
    } else if (threads.length === 0 && !activeThreadId) {
      setMessages([]);
      setSuggestion(null);
      setProfileUpdates([]);
    }
  }, [threads, activeThreadId, initialThreadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, timeline]);

  const pinRevisionContext = useCallback(async (decisionId: string) => {
    if (!activeThreadId) return;
    await fetch(apiUrl(`/api/shadow-chat/threads/${encodeURIComponent(activeThreadId)}/report-context`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision_id: decisionId, mode: 'revision' }),
    });
  }, [activeThreadId]);

  const openExecutionCalendar = useCallback(
    (decisionId: string) => {
      if (!activeThreadId) {
        navigate(`/execution/${encodeURIComponent(decisionId)}`);
        return;
      }
      navigate(
        `/execution/${encodeURIComponent(decisionId)}?from=shadow&threadId=${encodeURIComponent(activeThreadId)}`,
      );
    },
    [activeThreadId, navigate],
  );

  const onOpenReportArtifact = useCallback(
    (decisionId: string) => {
      setReportOpen(true);
      void loadExistingTrace(decisionId);
    },
    [loadExistingTrace],
  );

  const onReviseFromArtifactOrPanel = useCallback(
    async (decisionId: string) => {
      setReportOpen(false);
      setAgentStatus('idle');
      await pinRevisionContext(decisionId);
      setMessages((prev) => [
        ...prev,
        {
          id: `revise-hint-${Date.now()}`,
          role: 'assistant',
          content:
            'What would you like to change about the decision report — emphasis, risks, options, or next actions? For a full re-score and new report, use **Generate Decision Report** again after we align on what should change.',
        },
      ]);
    },
    [pinRevisionContext],
  );

  useEffect(() => {
    if (!initialOpenReportId || !activeThreadId) return;
    if (initialThreadId && activeThreadId !== initialThreadId) return;
    setReportOpen(true);
    void loadExistingTrace(initialOpenReportId);
  }, [initialOpenReportId, initialThreadId, activeThreadId, loadExistingTrace]);

  const streamMessage = async (
    text: string,
    userAction: string = 'send_message',
    clarificationAnswers?: Record<string, string>,
    saveClarificationToProfile?: boolean,
  ) => {
    if (!activeThreadId) return;
    setSending(true);
    try {
      setAgentStatus('reading_memory');
      pushTimeline('Reading memory');
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text }]);

      let res: Response;
      try {
        res = await fetch(apiUrl(`/api/shadow-chat/threads/${encodeURIComponent(activeThreadId)}/stream`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            user_action: userAction,
            clarification_answers: clarificationAnswers,
            save_clarification_to_profile: Boolean(saveClarificationToProfile),
          }),
        });
      } catch (e) {
        setAgentStatus('error');
        pushTimeline(e instanceof Error ? e.message : 'Network request failed');
        return;
      }
      if (!res.ok || !res.body) {
        setAgentStatus('error');
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let draft = '';
      let draftId = `a-draft-${Date.now()}`;
      let done = false;
      let readFailed = false;

      const upsertDraft = () => {
        setMessages((prev) => {
          const idx = prev.findIndex((x) => x.id === draftId);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], content: draft };
            return copy;
          }
          return [...prev, { id: draftId, role: 'assistant', content: draft }];
        });
      };

      const onEvent = (ev: Record<string, unknown>) => {
        const type = String(ev.type || '');
        if (type === 'status') {
          const st = String(ev.status || 'idle') as AgentStatus;
          const label = String(ev.label || st);
          flushSync(() => {
            setAgentStatus(st);
            pushTimeline(label);
          });
        } else if (type === 'delta') {
          draft += String(ev.content || '');
          upsertDraft();
        } else if (type === 'profile_update') {
          const items = Array.isArray(ev.items) ? ev.items.map(String) : [];
          setProfileUpdates(items);
        } else if (type === 'decision_suggestion') {
          const s = (ev.suggestion || null) as ShadowSuggestion | null;
          setSuggestion(s);
        } else if (type === 'done') {
          done = true;
          if (ev.stream_error) {
            setAgentStatus('error');
            return;
          }
          const msg = ev.message as ShadowMessage | undefined;
          if (msg && msg.id) {
            setMessages((prev) => {
              const withoutDraft = prev.filter((x) => x.id !== draftId);
              return [...withoutDraft, msg];
            });
          }
          if (ev.metrics && typeof ev.metrics === 'object') {
            pushTimeline(`response ${String((ev.metrics as Record<string, unknown>).response_total_ms ?? '')}ms`);
          }
          setAgentStatus('idle');
        } else if (type === 'error') {
          setAgentStatus('error');
          const detail = typeof ev.message === 'string' ? ev.message : 'Request failed';
          pushTimeline(detail.length > 100 ? `${detail.slice(0, 100)}…` : detail);
        }
      };

      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          readFailed = true;
          setAgentStatus('error');
          pushTimeline('Connection lost (stream interrupted)');
          break;
        }
        const { done: end, value } = chunk;
        if (end) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseBlocks(buffer, onEvent);
      }
      if (!readFailed && buffer.trim()) {
        parseSseBlocks(`${buffer}\n\n`, onEvent);
      }

      if (!readFailed && !done) {
        setAgentStatus('error');
        pushTimeline('Stream ended without completion');
      }
    } catch (e) {
      setAgentStatus('error');
      pushTimeline(e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setSending(false);
    }
    await refreshThreads();
  };

  const activeTitle = useMemo(
    () => threads.find((t) => t.thread_id === activeThreadId)?.title || (threads.length ? 'Shadow Chat' : 'No chat selected'),
    [threads, activeThreadId],
  );

  const beginDecisionReport = async (
    seedPrompt?: string,
    clarificationAnswers?: Record<string, string>,
    saveClarificationToProfile?: boolean,
  ) => {
    if (!activeThreadId) return;
    try {
      const lastUser = seedPrompt ?? (messages.filter((m) => m.role === 'user').slice(-1)[0]?.content || 'Help me decide.');
      setSuggestion(null);
      setReportOpen(true);
      setAgentStatus('report_generating' as AgentStatus);
      pushTimeline('Generating report');
      const { trace: doneTrace, error: streamError } = await reportStream.start({
        threadId: activeThreadId,
        decisionPrompt: lastUser,
        clarificationAnswers,
        saveClarificationToProfile,
      });
      if (streamError && streamError !== 'cancelled') {
        setAgentStatus('error');
        pushTimeline(streamError.length > 80 ? `${streamError.slice(0, 80)}…` : streamError);
        return;
      }
      if (doneTrace && typeof doneTrace.decision_id === 'string') {
        setAgentStatus('report_complete' as AgentStatus);
        pushTimeline('Report complete');
        await loadThread(activeThreadId);
        await refreshThreads();
      }
    } catch (e) {
      setAgentStatus('error');
      pushTimeline(e instanceof Error ? e.message : 'Decision report failed');
    }
  };

  const requestClarifyIfNeeded = useCallback(
    async (text: string, kind: 'chat' | 'report'): Promise<boolean> => {
      if (!text.trim()) return false;
      setClarifyChecking(true);
      try {
        const cr = await fetch(apiUrl('/api/clarify'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw_input: text }),
        });
        if (cr.ok) {
          const gate = (await cr.json()) as {
            need_clarification?: boolean;
            questions?: ClarifyQuestion[];
            note?: string;
          };
          if (gate.need_clarification && Array.isArray(gate.questions) && gate.questions.length > 0) {
            setPendingClarifyAction({ kind, text });
            setClarifyPayload({ questions: gate.questions, note: String(gate.note ?? '') });
            setClarifyOpen(true);
            return true;
          }
        }
      } catch {
        // Optional gate. Ignore failures and continue.
      } finally {
        setClarifyChecking(false);
      }
      return false;
    },
    [],
  );

  const onGenerateDecisionReport = useCallback(async () => {
    const lastUser = messages.filter((m) => m.role === 'user').slice(-1)[0]?.content || 'Help me decide.';
    if (clarifyOpen || clarifyChecking) return;
    const blockedByClarify = await requestClarifyIfNeeded(lastUser, 'report');
    if (!blockedByClarify) {
      await beginDecisionReport(lastUser);
    }
  }, [messages, clarifyOpen, clarifyChecking, requestClarifyIfNeeded]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-4 py-6">
      <div className="mx-auto max-w-[1500px]">
        <MainNavButtons />
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-3xl text-gray-900" style={{ fontWeight: 700 }}>Shadow Chat</h1>
          <p className="text-sm text-gray-500">{activeTitle}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-3">
            <ChatSidebar
              threads={threads}
              activeThreadId={activeThreadId}
              onNewChat={() => void newChat()}
              onSelectThread={(id) => void loadThread(id)}
              onDeleteThread={async (id) => {
                await fetch(apiUrl(`/api/shadow-chat/threads/${encodeURIComponent(id)}`), { method: 'DELETE' });
                setActiveThreadId(null);
                await refreshThreads();
              }}
            />
          </div>
          <div className="lg:col-span-6">
            <section className="rounded-[28px] border border-white/90 bg-white/65 p-4 shadow-[0_16px_42px_rgba(99,102,241,0.09)] backdrop-blur-md">
              <div className="min-h-[58vh] max-h-[66vh] overflow-y-auto px-1 py-3">
                <ChatMessageList
                  messages={messages}
                  onOpenReportArtifact={onOpenReportArtifact}
                  onReviseArtifact={onReviseFromArtifactOrPanel}
                  onArtifactExecutionCalendar={openExecutionCalendar}
                />
                <div ref={bottomRef} />
              </div>
              <div className="mt-3 space-y-3 border-t border-gray-200/80 pt-3">
                <DecisionSuggestionCard
                  suggestion={suggestion}
                  onGenerate={() => void onGenerateDecisionReport()}
                  onKeep={() => setSuggestion(null)}
                />
                <ProfileUpdateCard items={profileUpdates} />
                {!activeThreadId ? (
                  <p className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
                    Click <span className="font-semibold">New Chat</span> to start. Threads are only created manually now.
                  </p>
                ) : null}
                <ShadowChatInput
                  disabled={sending || !activeThreadId || clarifyChecking}
                  onSend={async (t) => {
                    if (!activeThreadId || clarifyOpen || clarifyChecking) return;
                    const blockedByClarify = await requestClarifyIfNeeded(t, 'chat');
                    if (!blockedByClarify) {
                      await streamMessage(t);
                    }
                  }}
                />
              </div>
            </section>
          </div>
          <div className="lg:col-span-3">
            <AgentPresence3DPanel
              status={agentStatus}
              timeline={timeline}
              suggestion={suggestion}
              onGenerateReport={() => void onGenerateDecisionReport()}
            />
          </div>
        </div>
      </div>
      <DecisionReportStreamingPanel
        open={reportOpen}
        trace={reportStream.trace}
        progressStep={reportStream.progressStep}
        isStreaming={reportStream.isStreaming}
        error={reportStream.error}
        onClose={() => {
          setReportOpen(false);
          setAgentStatus('idle');
        }}
        onContinueChat={() => {
          setReportOpen(false);
          setAgentStatus('idle');
        }}
        onOpenExecutionCalendar={(decisionId) => {
          openExecutionCalendar(decisionId);
          setReportOpen(false);
          setAgentStatus('idle');
        }}
        onReviseReport={(decisionId) => void onReviseFromArtifactOrPanel(decisionId)}
      />
      <ClarifyDialog
        open={clarifyOpen}
        onOpenChange={(open) => {
          setClarifyOpen(open);
          if (!open) {
            setPendingClarifyAction(null);
            setClarifyPayload(null);
          }
        }}
        note={clarifyPayload?.note}
        questions={clarifyPayload?.questions ?? []}
        onConfirm={(answers, saveToProfile) => {
          const pending = pendingClarifyAction;
          setPendingClarifyAction(null);
          setClarifyPayload(null);
          if (!pending) return;
          if (pending.kind === 'chat') {
            void streamMessage(pending.text, 'send_message', answers, saveToProfile);
            return;
          }
          void beginDecisionReport(pending.text, answers, saveToProfile);
        }}
      />
    </div>
  );
}
