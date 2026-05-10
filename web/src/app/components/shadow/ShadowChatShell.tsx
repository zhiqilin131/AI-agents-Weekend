import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { MainNavButtons } from '../MainNavButtons';
import type { ClarifyQuestion } from '../ClarifyDialog';
import { ClarificationCard, type ClarificationGateMeta } from './ClarificationCard';
import { apiFetch } from '../../../utils/apiFetch';
import { parseSseBlocks } from '../../../utils/parseSse';
import { refetchSlimeProfileGlobal } from '../../../hooks/useSlimeProfile';
import { useDecisionReportStream } from '../../../hooks/useDecisionReportStream';
import { AgentPresence3DPanel } from './AgentPresence3DPanel';
import { ChatMessageList } from './ChatMessageList';
import { ChatSidebar } from './ChatSidebar';
import { DecisionReportStreamingPanel } from './DecisionReportStreamingPanel';
import { DecisionSuggestionCard } from './DecisionSuggestionCard';
import { ProfileUpdateCard } from './ProfileUpdateCard';
import { ShadowChatInput } from './ShadowChatInput';
import type { AgentStatus, ShadowMessage, ShadowSuggestion, ShadowThread } from './types';
import { detectCalendarFeedbackIntent } from '../../../utils/calendarFeedbackIntent';
import {
  loadCoachSchedulerOptions,
  mergeRefinedScheduleIntoStorage,
  readExecutionPlannerSnapshot,
  refineScheduleWithFeedback,
} from '../../../utils/calendarRefineSchedule';
import {
  clearSelectedBlocksContext,
  loadSelectedBlocksContext,
} from '../../../utils/executionCalendarSelection';
import { SLIME_VOICE_CHAT_PREFILL_KEY } from '../../../utils/slimeVoiceActions';
import { EXECUTION_PENDING_CALENDAR_FEEDBACK_KEY } from '../../../utils/executionStorageKeys';
import { primeSpeechSynthesisFromGesture } from '../../../app/hooks/useSpeechSynthesis';

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
  /** Profile saves from thread JSON — shown inside the chat transcript after reload */
  const [threadMemoryLog, setThreadMemoryLog] = useState<Array<{ kind: string; items: string[]; at: string }>>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [clarifyPayload, setClarifyPayload] = useState<{
    questions: ClarifyQuestion[];
    note: string;
    meta?: ClarificationGateMeta | null;
  } | null>(null);
  const [pendingClarifyAction, setPendingClarifyAction] = useState<{
    kind: 'chat' | 'report';
    text: string;
  } | null>(null);
  const [calendarCoachHint, setCalendarCoachHint] = useState<string | null>(null);
  const [calendarCoachBusy, setCalendarCoachBusy] = useState(false);
  const [plannerSelectionContext, setPlannerSelectionContext] = useState(() => loadSelectedBlocksContext());
  const bottomRef = useRef<HTMLDivElement>(null);
  /** Hold decision_suggestion until `done` + thread reload so the card does not flash then disappear. */
  const lastDecisionSuggestionRef = useRef<ShadowSuggestion | null>(null);
  const reportGeneratingRef = useRef(false);
  const streamTurnSeqRef = useRef(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [inputBootstrap, setInputBootstrap] = useState<string | null>(null);
  const reportStream = useDecisionReportStream();
  const { loadExistingTrace } = reportStream;

  const pushTimeline = (x: string) =>
    setTimeline((s) => {
      if (s[s.length - 1] === x) return s;
      return [...s, x].slice(-6);
    });

  const refreshThreads = async () => {
    const res = await apiFetch('/api/shadow-chat/threads');
    if (!res.ok) return;
    const data = (await res.json()) as { threads: ShadowThread[] };
    setThreads(data.threads || []);
  };

  const loadThread = async (id: string, opts?: { preservePendingSuggestion?: boolean }) => {
    const res = await apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const data = (await res.json()) as { thread: ShadowThread };
    setActiveThreadId(data.thread.thread_id);
    setMessages(data.thread.messages || []);
    setSuggestion(null);
    if (!opts?.preservePendingSuggestion) {
      lastDecisionSuggestionRef.current = null;
    }
    setProfileUpdates([]);
    setThreadMemoryLog(
      Array.isArray(data.thread.memory_events)
        ? (data.thread.memory_events as Array<{ kind: string; items: string[]; at: string }>)
        : [],
    );
  };

  const newChat = async () => {
    const res = await apiFetch('/api/shadow-chat/threads', {
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
    try {
      const raw = sessionStorage.getItem(SLIME_VOICE_CHAT_PREFILL_KEY);
      if (!raw?.trim()) return;
      sessionStorage.removeItem(SLIME_VOICE_CHAT_PREFILL_KEY);
      setInputBootstrap(raw.trim());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (threads.length > 0 && !activeThreadId) {
      const prefer = initialThreadId && threads.some((t) => t.thread_id === initialThreadId) ? initialThreadId : threads[0].thread_id;
      void loadThread(prefer);
    } else if (threads.length === 0 && !activeThreadId) {
      setMessages([]);
      setSuggestion(null);
      lastDecisionSuggestionRef.current = null;
      setProfileUpdates([]);
      setThreadMemoryLog([]);
    }
  }, [threads, activeThreadId, initialThreadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, timeline, threadMemoryLog]);

  /** Recover `report_generating` if chat streaming callbacks briefly set `idle` during report generation. */
  useEffect(() => {
    if (reportOpen && reportStream.status === 'streaming') {
      setAgentStatus('report_generating');
    }
  }, [reportOpen, reportStream.status]);

  useEffect(() => {
    setPlannerSelectionContext(loadSelectedBlocksContext());
    const last = [...messages].reverse().find((m) => m.role === 'user');
    if (last?.content && detectCalendarFeedbackIntent(last.content)) {
      setCalendarCoachHint(last.content);
    } else {
      setCalendarCoachHint(null);
    }
  }, [messages]);

  const pinRevisionContext = useCallback(async (decisionId: string) => {
    if (!activeThreadId) return;
    await apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(activeThreadId)}/report-context`, {
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
      primeSpeechSynthesisFromGesture();
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
      setSuggestion(null);
      lastDecisionSuggestionRef.current = null;
      setClarifyOpen(false);
      setClarifyPayload(null);
      setPendingClarifyAction(null);

      const streamSeq = ++streamTurnSeqRef.current;
      setAgentStatus('reading_memory');
      pushTimeline('Reading memory');
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text }]);

      let res: Response;
      try {
        res = await apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(activeThreadId)}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            user_action: userAction,
            clarification_answers: clarificationAnswers,
            save_clarification_to_profile: Boolean(saveClarificationToProfile),
            client_turn_seq: streamSeq,
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
          if (reportGeneratingRef.current) return;
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
        } else if (type === 'thread_context_note') {
          const note =
            typeof ev.message === 'string' && ev.message.trim()
              ? ev.message.trim()
              : 'Keeping this in the current chat context';
          pushTimeline(note);
        } else if (type === 'clarification') {
          const seqEv = ev.client_turn_seq;
          if (seqEv != null && seqEv !== streamSeq) return;
          const qs = ev.questions;
          if (!Array.isArray(qs) || qs.length === 0) return;
          const metaRaw = ev.clarification_meta;
          const meta =
            metaRaw && typeof metaRaw === 'object' ? (metaRaw as ClarificationGateMeta) : null;
          setClarifyPayload({
            questions: qs as ClarifyQuestion[],
            note: typeof ev.note === 'string' ? ev.note : '',
            meta,
          });
          setClarifyOpen(true);
          setPendingClarifyAction(null);
        } else if (type === 'decision_suggestion') {
          lastDecisionSuggestionRef.current = (ev.suggestion || null) as ShadowSuggestion | null;
        } else if (type === 'done') {
          done = true;
          const fe = ev.frontend_action as { type?: string } | undefined;
          if (fe?.type === 'slime_profile_refresh') {
            void refetchSlimeProfileGlobal();
          }
          if (ev.stream_error) {
            setAgentStatus('error');
          } else {
            if (ev.metrics && typeof ev.metrics === 'object') {
              pushTimeline(`response ${String((ev.metrics as Record<string, unknown>).response_total_ms ?? '')}ms`);
            }
            if (!reportGeneratingRef.current) {
              setAgentStatus('idle');
            }
          }
          // Drop streaming draft; reload thread from server so user text matches merged clarification
          // and assistant rows are never stuck missing after a partial stream failure.
          setMessages((prev) => prev.filter((x) => x.id !== draftId));
          if (activeThreadId) {
            void loadThread(activeThreadId, { preservePendingSuggestion: true }).then(() => {
              const fromDone =
                ev && typeof ev === 'object' && 'suggestion' in ev
                  ? ((ev as { suggestion?: ShadowSuggestion | null }).suggestion ?? null)
                  : undefined;
              setSuggestion(
                fromDone !== undefined ? fromDone : lastDecisionSuggestionRef.current,
              );
              lastDecisionSuggestionRef.current = null;
            });
          }
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
    if (!activeThreadId) {
      pushTimeline('Pick or create a chat thread first');
      return;
    }
    primeSpeechSynthesisFromGesture();
    reportGeneratingRef.current = true;
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
    } finally {
      reportGeneratingRef.current = false;
    }
  };

  /** Always invoke latest beginDecisionReport — avoids stale useCallback closing over null activeThreadId. */
  const beginDecisionReportRef = useRef(beginDecisionReport);
  beginDecisionReportRef.current = beginDecisionReport;

  const requestClarifyIfNeeded = useCallback(
    async (text: string, kind: 'chat' | 'report'): Promise<boolean> => {
      if (!text.trim()) return false;
      if (kind === 'report') {
        pushTimeline('Checking if a quick clarification helps…');
      }
      try {
        const body: Record<string, unknown> = { raw_input: text, purpose: 'shadow_chat' };
        if (activeThreadId) {
          body.thread_id = activeThreadId;
          body.recent_messages = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
        }
        const cr = await apiFetch('/api/clarify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (cr.ok) {
          const gate = (await cr.json()) as {
            need_clarification?: boolean;
            questions?: ClarifyQuestion[];
            note?: string;
            clarification_meta?: ClarificationGateMeta;
          };
          if (gate.need_clarification && Array.isArray(gate.questions) && gate.questions.length > 0) {
            setPendingClarifyAction({ kind, text });
            setClarifyPayload({
              questions: gate.questions,
              note: String(gate.note ?? ''),
              meta: gate.clarification_meta ?? null,
            });
            setClarifyOpen(true);
            return true;
          }
        }
      } catch {
        // Optional gate. Ignore failures and continue.
      }
      return false;
    },
    [activeThreadId, messages],
  );

  const applyCalendarCoachFromChat = useCallback(async () => {
    if (!calendarCoachHint?.trim()) return;
    setCalendarCoachBusy(true);
    try {
      const { tasks, events } = readExecutionPlannerSnapshot();
      if (tasks.length === 0) {
        sessionStorage.setItem(EXECUTION_PENDING_CALENDAR_FEEDBACK_KEY, calendarCoachHint.trim());
        setCalendarCoachHint(null);
        navigate('/execution?from=shadow');
        return;
      }
      const ctx = loadSelectedBlocksContext();
      const targetTaskIds = ctx?.taskIds?.length ? ctx.taskIds : undefined;
      const res = await refineScheduleWithFeedback({
        feedback: calendarCoachHint.trim(),
        tasks,
        plannerEvents: events,
        targetTaskIds,
        options: loadCoachSchedulerOptions(),
      });
      mergeRefinedScheduleIntoStorage(res, { targetTaskIds });
      clearSelectedBlocksContext();
      setPlannerSelectionContext(null);
      pushTimeline('Execution calendar updated from chat');
      setCalendarCoachHint(null);
    } catch (e) {
      pushTimeline(e instanceof Error ? e.message.slice(0, 80) : 'Calendar update failed');
    } finally {
      setCalendarCoachBusy(false);
    }
  }, [calendarCoachHint, navigate, pushTimeline]);

  const onGenerateDecisionReport = useCallback(async () => {
    primeSpeechSynthesisFromGesture();
    const lastUser = messages.filter((m) => m.role === 'user').slice(-1)[0]?.content || 'Help me decide.';
    if (clarifyOpen) {
      pushTimeline('Answer or skip the clarification card below first');
      return;
    }
    const blockedByClarify = await requestClarifyIfNeeded(lastUser, 'report');
    if (!blockedByClarify) {
      await beginDecisionReportRef.current(lastUser);
    }
  }, [messages, clarifyOpen, requestClarifyIfNeeded]);

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
                await apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
                  memoryLog={threadMemoryLog}
                  onOpenReportArtifact={onOpenReportArtifact}
                  onReviseArtifact={onReviseFromArtifactOrPanel}
                  onArtifactExecutionCalendar={openExecutionCalendar}
                  onSuggestionChip={(label) => setInputBootstrap(label)}
                />
                <div ref={bottomRef} />
              </div>
              <div className="mt-3 space-y-3 border-t border-gray-200/80 pt-3">
                <DecisionSuggestionCard
                  suggestion={suggestion}
                  disabled={sending || (clarifyOpen && pendingClarifyAction?.kind === 'report')}
                  onGenerate={() => void onGenerateDecisionReport()}
                  onKeep={() => setSuggestion(null)}
                />
                <ProfileUpdateCard items={profileUpdates} />
                {calendarCoachHint ? (
                  <div className="relative overflow-hidden rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-white/95 via-indigo-50/40 to-violet-50/50 px-3 py-3 shadow-[0_8px_30px_rgba(99,102,241,0.12)]">
                    <button
                      type="button"
                      className="absolute right-2 top-2 rounded-full p-1 text-slate-400 hover:bg-white/80 hover:text-slate-700"
                      aria-label="Dismiss calendar hint"
                      onClick={() => setCalendarCoachHint(null)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <div className="flex items-center gap-2 pr-8 text-indigo-900">
                      <Sparkles className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden />
                      <span className="text-xs font-semibold uppercase tracking-wide">Calendar insight</span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-700">{calendarCoachHint}</p>
                    {plannerSelectionContext && plannerSelectionContext.taskIds.length > 0 ? (
                      <div className="mt-2 rounded-lg border border-violet-200/80 bg-violet-50/90 px-2 py-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-900">Planner selection</p>
                        <p className="mt-0.5 text-[11px] text-violet-950">
                          Apply only to {plannerSelectionContext.taskIds.length} block(s):{' '}
                          {plannerSelectionContext.titles.slice(0, 4).join(' · ')}
                          {plannerSelectionContext.titles.length > 4 ? '…' : ''}
                        </p>
                        <button
                          type="button"
                          className="mt-1 text-[10px] font-medium text-violet-800 underline hover:text-violet-950"
                          onClick={() => {
                            clearSelectedBlocksContext();
                            setPlannerSelectionContext(null);
                          }}
                        >
                          Clear selection scope
                        </button>
                      </div>
                    ) : null}
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={calendarCoachBusy}
                        onClick={() => void applyCalendarCoachFromChat()}
                        className="rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50"
                      >
                        {calendarCoachBusy ? 'Applying…' : 'Apply to execution calendar'}
                      </button>
                      <button
                        type="button"
                        disabled={calendarCoachBusy}
                        onClick={() => {
                          sessionStorage.setItem(EXECUTION_PENDING_CALENDAR_FEEDBACK_KEY, calendarCoachHint.trim());
                          navigate('/execution?from=shadow');
                        }}
                        className="rounded-full border border-indigo-200/90 bg-white/80 px-3 py-2 text-xs font-medium text-indigo-900 hover:bg-white"
                      >
                        Open planner
                      </button>
                    </div>
                  </div>
                ) : null}
                {!activeThreadId ? (
                  <p className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
                    Click <span className="font-semibold">New Chat</span> to start. Threads are only created manually now.
                  </p>
                ) : null}
                {clarifyOpen && clarifyPayload ? (
                  <ClarificationCard
                    questions={clarifyPayload.questions}
                    meta={clarifyPayload.meta}
                    disabled={sending}
                    onSkip={async () => {
                      primeSpeechSynthesisFromGesture();
                      const pending = pendingClarifyAction;
                      const payload = clarifyPayload;
                      const q0 = payload?.questions[0];
                      const dim = (payload?.meta?.target_dimension || q0?.id || "").trim();
                      const qp = q0?.prompt ?? '';
                      setClarifyOpen(false);
                      setClarifyPayload(null);
                      setPendingClarifyAction(null);
                      if (activeThreadId && dim) {
                        try {
                          await apiFetch(
                            `/api/shadow-chat/threads/${encodeURIComponent(activeThreadId)}/clarification-skip`,
                            {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                target_dimension: dim,
                                question_prompt: qp,
                              }),
                            },
                          );
                        } catch {
                          /* optional */
                        }
                      }
                      if (!pending) return;
                      if (pending.kind === 'chat') {
                        await streamMessage(pending.text);
                        return;
                      }
                      await beginDecisionReport(pending.text);
                    }}
                    onAnswer={(answers, saveToProfile) => {
                      const pending = pendingClarifyAction;
                      setClarifyOpen(false);
                      setClarifyPayload(null);
                      setPendingClarifyAction(null);
                      if (pending?.kind === 'report') {
                        void beginDecisionReport(pending.text, answers, saveToProfile);
                        return;
                      }
                      if (pending?.kind === 'chat') {
                        void streamMessage(pending.text, 'send_message', answers, saveToProfile);
                        return;
                      }
                      const users = messagesRef.current.filter((m) => m.role === 'user');
                      const lastUser = users[users.length - 1]?.content?.trim();
                      if (lastUser) void streamMessage(lastUser, 'send_message', answers, saveToProfile);
                    }}
                  />
                ) : null}
                <ShadowChatInput
                  disabled={sending || !activeThreadId}
                  bootstrapText={inputBootstrap}
                  onBootstrapConsumed={() => setInputBootstrap(null)}
                  onSend={async (t) => {
                    if (!activeThreadId || sending) return;
                    await streamMessage(t);
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
              generateReportDisabled={sending || (clarifyOpen && pendingClarifyAction?.kind === 'report')}
              onGenerateReport={() => void onGenerateDecisionReport()}
              reportOverlaySession={
                reportOpen
                  ? { streaming: reportStream.isStreaming, progressStep: reportStream.progressStep }
                  : null
              }
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
        shadowThreadId={activeThreadId}
      />
    </div>
  );
}
