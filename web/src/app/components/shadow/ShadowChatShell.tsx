import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../auth/AuthContext';
import { useSlimeCredits } from '../credits/SlimeCreditsContext';
import { MainNavButtons } from '../MainNavButtons';
import type { ClarifyQuestion } from '../ClarifyDialog';
import type { ClarificationGateMeta } from './ClarificationCard';
import { apiFetch } from '../../../utils/apiFetch';
import { parseSseBlocks } from '../../../utils/parseSse';
import { refetchSlimeProfileGlobal } from '../../../hooks/useSlimeProfile';
import { useExecutionStorageUserKey } from '../../../hooks/useExecutionStorageUserKey';
import { useDecisionReportStream } from '../../../hooks/useDecisionReportStream';
import { ModelSelector } from '../../../features/models/ModelSelector';
import { buildCheaperModelHint } from '../../../features/models/slimeModelsApi';
import { useSlimeModelCatalog } from '../../../features/models/useSlimeModelCatalog';
import { BuddyTooltip } from '../../../features/slime/BuddyTooltip';
import type { SlimeCreditFeature } from '../../../features/models/types';
import { AgentPresence3DPanel } from './AgentPresence3DPanel';
import { ChatMessageList } from './ChatMessageList';
import { ChatSidebar } from './ChatSidebar';
import { DecisionReportStreamingPanel } from './DecisionReportStreamingPanel';
import { ThreadActionDock } from './ThreadActionDock';
import {
  buildClarificationPendingAction,
  decisionPromptFromPendingAction,
  messagesHaveDecisionReportArtifact,
  normalizeThreadMessages,
  pendingActionToSuggestion,
  type PendingAction,
} from './pendingActionTypes';
import {
  ProfileMemoryToastStack,
  type ProfileMemoryDetail,
  type ProfileMemoryToast,
  profileMemoryEventDedupeKey,
} from './ProfileMemoryToastStack';
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
import { unlockSlimeAudioContext } from '../../../utils/slimeAudioContext';

export function ShadowChatShell({
  initialThreadId = null,
  initialOpenReportId = null,
}: {
  initialThreadId?: string | null;
  initialOpenReportId?: string | null;
} = {}) {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { showInsufficient, refresh: refreshCredits } = useSlimeCredits();
  const slimeModels = useSlimeModelCatalog();
  const [modelOptionId, setModelOptionId] = useState('');
  useEffect(() => {
    if (slimeModels.ready && slimeModels.defaultModel && !modelOptionId) {
      setModelOptionId(slimeModels.defaultModel);
    }
  }, [slimeModels.ready, slimeModels.defaultModel, modelOptionId]);
  const { storageUserKey, ready: storageReady } = useExecutionStorageUserKey();
  const [threads, setThreads] = useState<ShadowThread[]>([]);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ShadowMessage[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [timeline, setTimeline] = useState<string[]>(['Ready']);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [profileMemoryToasts, setProfileMemoryToasts] = useState<ProfileMemoryToast[]>([]);
  const profileMemoryToastThreadRef = useRef<string | null>(null);
  const profileMemoryToastKeysRef = useRef<Set<string>>(new Set());
  const profileMemoryToastTimersRef = useRef<Map<string, number>>(new Map());
  const [reportOpen, setReportOpen] = useState(false);
  const [sending, setSending] = useState(false);
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
  const autoCreateThreadRef = useRef(false);
  const reportGeneratingRef = useRef(false);
  const streamTurnSeqRef = useRef(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [inputBootstrap, setInputBootstrap] = useState<string | null>(null);
  const reportStream = useDecisionReportStream();
  const { loadExistingTrace } = reportStream;

  const dismissProfileMemoryToast = useCallback((id: string) => {
    const t = profileMemoryToastTimersRef.current.get(id);
    if (t != null) {
      window.clearTimeout(t);
      profileMemoryToastTimersRef.current.delete(id);
    }
    setProfileMemoryToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const clearAllProfileMemoryToasts = useCallback(() => {
    profileMemoryToastTimersRef.current.forEach((tid) => window.clearTimeout(tid));
    profileMemoryToastTimersRef.current.clear();
    setProfileMemoryToasts([]);
  }, []);

  const scheduleProfileMemoryToast = useCallback(
    (ev: { items: string[]; at: string; details?: ProfileMemoryDetail[] }) => {
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `pm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      setProfileMemoryToasts((prev) => [...prev.slice(-4), { id, items: ev.items, at: ev.at, details: ev.details }]);
      const timer = window.setTimeout(() => dismissProfileMemoryToast(id), 6200);
      profileMemoryToastTimersRef.current.set(id, timer);
    },
    [dismissProfileMemoryToast],
  );

  useEffect(
    () => () => {
      profileMemoryToastTimersRef.current.forEach((tid) => window.clearTimeout(tid));
      profileMemoryToastTimersRef.current.clear();
    },
    [],
  );

  const pushTimeline = (x: string) =>
    setTimeline((s) => {
      if (s[s.length - 1] === x) return s;
      return [...s, x].slice(-6);
    });

  const refreshThreads = useCallback(async () => {
    const res = await apiFetch('/api/shadow-chat/threads');
    if (!res.ok) return;
    const data = (await res.json()) as { threads: ShadowThread[] };
    setThreads(data.threads || []);
    setThreadsLoaded(true);
  }, []);

  const loadThread = async (id: string, opts?: { preservePendingSuggestion?: boolean }) => {
    const res = await apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has('thread')) {
        sp.delete('thread');
        const q = sp.toString();
        navigate(q ? `/chat?${q}` : '/chat', { replace: true });
      }
      setActiveThreadId(null);
      await refreshThreads();
      return;
    }
    if (!res.ok) {
      pushTimeline(`Could not load chat (${res.status})`);
      return;
    }
    const data = (await res.json()) as { thread: ShadowThread };
    const tid = data.thread.thread_id;
    const mem = Array.isArray(data.thread.memory_events)
      ? (data.thread.memory_events as Array<{ kind: string; items: string[]; at: string; details?: ProfileMemoryDetail[] }>)
      : [];
    const profileEvents = mem.filter(
      (ev) => ev.kind === 'profile_update' && Array.isArray(ev.items) && ev.items.length > 0,
    );

    if (profileMemoryToastThreadRef.current !== tid) {
      profileMemoryToastThreadRef.current = tid;
      clearAllProfileMemoryToasts();
      profileMemoryToastKeysRef.current = new Set(profileEvents.map(profileMemoryEventDedupeKey));
    } else {
      for (const ev of profileEvents) {
        const k = profileMemoryEventDedupeKey(ev);
        if (profileMemoryToastKeysRef.current.has(k)) continue;
        profileMemoryToastKeysRef.current.add(k);
        scheduleProfileMemoryToast({ items: ev.items, at: ev.at, details: ev.details });
      }
    }

    setActiveThreadId(tid);
    const msgs = normalizeThreadMessages(data.thread.messages || []);
    setMessages(msgs);
    const pa = data.thread.pending_action;
    const hasArtifact = messagesHaveDecisionReportArtifact(msgs);
    if (
      pa &&
      typeof pa === 'object' &&
      pa.type &&
      !(pa.type === 'decision_report' && hasArtifact)
    ) {
      setPendingAction(pa as PendingAction);
    } else if (!opts?.preservePendingSuggestion) {
      setPendingAction(null);
    }
    if (!opts?.preservePendingSuggestion) {
      lastDecisionSuggestionRef.current = null;
    }
  };

  const newChat = async (opts?: { fromAuto?: boolean }) => {
    if (autoCreateThreadRef.current && !opts?.fromAuto) return;
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

  const deleteProfileMemoryFromToast = useCallback(
    async (factId: string, toastId: string) => {
      if (!factId) return;
      try {
        const res = await apiFetch(`/api/profile/memory-fact/${encodeURIComponent(factId)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        dismissProfileMemoryToast(toastId);
        if (activeThreadId) void loadThread(activeThreadId, { preservePendingSuggestion: true });
      } catch {
        pushTimeline('Could not delete that memory');
      }
    },
    [activeThreadId, dismissProfileMemoryToast],
  );

  const openProfileMemoryEditor = useCallback((factId?: string) => {
    const suffix = factId ? `?memory=${encodeURIComponent(factId)}` : '';
    navigate(`/profile${suffix}`);
  }, [navigate]);

  const prevAuthUserRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const key = session?.user?.id ?? '';
    const prev = prevAuthUserRef.current;
    if (prev !== undefined && prev !== key) {
      setActiveThreadId(null);
      setMessages([]);
      setThreadsLoaded(false);
      autoCreateThreadRef.current = false;
      setPendingAction(null);
      lastDecisionSuggestionRef.current = null;
      profileMemoryToastThreadRef.current = null;
      profileMemoryToastKeysRef.current.clear();
      profileMemoryToastTimersRef.current.forEach((tid) => window.clearTimeout(tid));
      profileMemoryToastTimersRef.current.clear();
      setProfileMemoryToasts([]);
      const sp = new URLSearchParams(window.location.search);
      if (sp.has('thread')) {
        sp.delete('thread');
        const q = sp.toString();
        navigate(q ? `/chat?${q}` : '/chat', { replace: true });
      }
    }
    prevAuthUserRef.current = key;
    void refreshThreads();
  }, [session?.user?.id, navigate, refreshThreads]);

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
    } else if (threadsLoaded && threads.length === 0 && !activeThreadId) {
      if (autoCreateThreadRef.current) return;
      autoCreateThreadRef.current = true;
      setMessages([]);
      setPendingAction(null);
      lastDecisionSuggestionRef.current = null;
      profileMemoryToastThreadRef.current = null;
      profileMemoryToastKeysRef.current.clear();
      profileMemoryToastTimersRef.current.forEach((tid) => window.clearTimeout(tid));
      profileMemoryToastTimersRef.current.clear();
      setProfileMemoryToasts([]);
      void (async () => {
        await newChat({ fromAuto: true });
        autoCreateThreadRef.current = false;
      })();
    }
  }, [threadsLoaded, threads, activeThreadId, initialThreadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, timeline]);

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
      unlockSlimeAudioContext();
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
      setPendingAction(null);
      lastDecisionSuggestionRef.current = null;
      setPendingClarifyAction(null);

      const streamSeq = ++streamTurnSeqRef.current;
      setAgentStatus('reading_memory');
      pushTimeline('Reading memory');
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text }]);

      const creditReq =
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `chat-${Date.now()}`;
      let res: Response;
      try {
        res = await apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(activeThreadId)}/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Credit-Request-Id': creditReq,
          },
          body: JSON.stringify({
            message: text,
            user_action: userAction,
            clarification_answers: clarificationAnswers,
            save_clarification_to_profile: Boolean(saveClarificationToProfile),
            client_turn_seq: streamSeq,
            credit_request_id: creditReq,
            ...(modelOptionId ? { model_option_id: modelOptionId } : {}),
          }),
        });
      } catch (e) {
        setAgentStatus('error');
        pushTimeline(e instanceof Error ? e.message : 'Network request failed');
        return;
      }
      if (res.status === 402) {
        let j: Record<string, unknown> = {};
        try {
          j = (await res.json()) as Record<string, unknown>;
        } catch {
          /* ignore */
        }
        const mid = modelOptionId || slimeModels.defaultModel || 'little';
        const creditFeat: SlimeCreditFeature =
          userAction === 'generate_decision_report' ? 'decision_report' : 'shadow_chat';
        const cheaperHint =
          slimeModels.models.length > 0
            ? await buildCheaperModelHint(creditFeat, mid, slimeModels.models)
            : undefined;
        showInsufficient({
          required: Number(j.required ?? 0),
          balance: typeof j.balance === 'number' ? j.balance : null,
          message:
            typeof j.message === 'string'
              ? j.message
              : 'You need more Slime Credits for this action.',
          cheaperHint,
        });
        setAgentStatus('idle');
        setSending(false);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'user' && last.content === text) return prev.slice(0, -1);
          return prev;
        });
        return;
      }
      if (!res.ok || !res.body) {
        setAgentStatus('error');
        const errText = !res.ok ? `Chat request failed (${res.status})` : 'Chat stream unavailable';
        pushTimeline(errText.length > 80 ? `${errText.slice(0, 80)}…` : errText);
        setSending(false);
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
          /* Shown via bottom-left toast after thread reload (loadThread). */
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
          const paEv = ev.pending_action;
          if (paEv && typeof paEv === 'object') {
            setPendingAction(paEv as PendingAction);
          } else {
            setPendingAction(
              buildClarificationPendingAction(qs as ClarifyQuestion[], meta, typeof ev.note === 'string' ? ev.note : ''),
            );
          }
          setPendingClarifyAction(null);
        } else if (type === 'pending_action_updated') {
          const paUp = ev.pending_action;
          if (paUp && typeof paUp === 'object') setPendingAction(paUp as PendingAction);
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
            void refreshCredits();
            if (ev.metrics && typeof ev.metrics === 'object') {
              pushTimeline(`response ${String((ev.metrics as Record<string, unknown>).response_total_ms ?? '')}ms`);
            }
            if (!reportGeneratingRef.current) {
              setAgentStatus('idle');
            }
          }
          const paDone = ev.pending_action;
          if (paDone && typeof paDone === 'object') {
            setPendingAction(paDone as PendingAction);
          }
          const serverLast = normalizeThreadMessages(ev.message ? [ev.message] : [])[0];
          if (serverLast?.content?.trim()) {
            setMessages((prev) => {
              const withoutDraft = prev.filter((x) => x.id !== draftId && x.id !== serverLast.id);
              return [...withoutDraft, serverLast];
            });
          } else if (draft.trim()) {
            setMessages((prev) => {
              const idx = prev.findIndex((x) => x.id === draftId);
              if (idx >= 0) return prev;
              return [...prev, { id: draftId, role: 'assistant', content: draft }];
            });
          }
          if (activeThreadId) {
            void loadThread(activeThreadId, { preservePendingSuggestion: true })
              .then(() => {
                if (!paDone && lastDecisionSuggestionRef.current) {
                  const sug = lastDecisionSuggestionRef.current;
                  if (sug?.type === 'decision_report' || sug?.type === 'role_mode') {
                    setPendingAction({
                      id: `sse-sug-${Date.now()}`,
                      type: sug.type,
                      title: sug.title,
                      message: sug.message,
                      blocks: sug.type === 'decision_report' ? ['generate_decision_report'] : ['send_message'],
                      payload: {},
                    });
                  }
                }
                lastDecisionSuggestionRef.current = null;
              })
              .catch(() => {
                pushTimeline('Could not refresh thread from server');
              });
          } else {
            lastDecisionSuggestionRef.current = null;
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
    unlockSlimeAudioContext();
    reportGeneratingRef.current = true;
    try {
      const lastUser =
        seedPrompt ??
        (decisionPromptFromPendingAction(pendingAction) ||
          (messages.filter((m) => m.role === 'user').slice(-1)[0]?.content || 'Help me decide.'));
      setPendingAction(null);
      lastDecisionSuggestionRef.current = null;
      setReportOpen(true);
      setAgentStatus('report_generating' as AgentStatus);
      pushTimeline('Generating report');
      const { trace: doneTrace, error: streamError } = await reportStream.start({
        threadId: activeThreadId,
        decisionPrompt: lastUser,
        clarificationAnswers,
        saveClarificationToProfile,
        modelOptionId: modelOptionId || undefined,
      });
      if (streamError === 'insufficient_credits') {
        setReportOpen(false);
        setAgentStatus('idle');
        pushTimeline('Not enough Slime Credits — add credits in Profile, then try again.');
        return;
      }
      if (streamError && streamError !== 'cancelled') {
        setAgentStatus('error');
        pushTimeline(streamError.length > 80 ? `${streamError.slice(0, 80)}…` : streamError);
        return;
      }
      if (doneTrace && typeof doneTrace.decision_id === 'string') {
        setAgentStatus('report_complete' as AgentStatus);
        pushTimeline('Report complete');
        void refreshCredits();
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
        if (modelOptionId) body.model_option_id = modelOptionId;
        const clarifyCredit =
          typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `clarify-${Date.now()}`;
        const cr = await apiFetch('/api/clarify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Credit-Request-Id': clarifyCredit,
          },
          body: JSON.stringify(body),
        });
        if (cr.status === 402) {
          let j: Record<string, unknown> = {};
          try {
            j = (await cr.json()) as Record<string, unknown>;
          } catch {
            /* ignore */
          }
          const mid = modelOptionId || slimeModels.defaultModel || 'little';
          const cheaperHint =
            slimeModels.models.length > 0
              ? await buildCheaperModelHint('shadow_chat', mid, slimeModels.models)
              : undefined;
          showInsufficient({
            required: Number(j.required ?? 0),
            balance: typeof j.balance === 'number' ? j.balance : null,
            message:
              typeof j.message === 'string'
                ? j.message
                : 'You need more Slime Credits for this action.',
            cheaperHint,
          });
          return true;
        }
        if (cr.ok) {
          const gate = (await cr.json()) as {
            need_clarification?: boolean;
            questions?: ClarifyQuestion[];
            note?: string;
            clarification_meta?: ClarificationGateMeta;
          };
          if (gate.need_clarification && Array.isArray(gate.questions) && gate.questions.length > 0) {
            setPendingClarifyAction({ kind, text });
            const gatePa = (gate as { pending_action?: PendingAction }).pending_action;
            if (gatePa && typeof gatePa === 'object' && gatePa.type) {
              setPendingAction(gatePa);
            } else {
              setPendingAction(
                buildClarificationPendingAction(
                  gate.questions,
                  gate.clarification_meta ?? null,
                  String(gate.note ?? ''),
                ),
              );
            }
            return true;
          }
        }
      } catch {
        // Optional gate. Ignore failures and continue.
      }
      return false;
    },
    [activeThreadId, messages, modelOptionId, slimeModels.defaultModel, slimeModels.models, showInsufficient],
  );

  const applyCalendarCoachFromChat = useCallback(async () => {
    if (!calendarCoachHint?.trim()) return;
    if (!storageReady || !storageUserKey) {
      pushTimeline('Calendar workspace still loading — try again in a moment.');
      return;
    }
    setCalendarCoachBusy(true);
    try {
      const { tasks, events } = readExecutionPlannerSnapshot(storageUserKey);
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
        options: loadCoachSchedulerOptions(storageUserKey),
      });
      mergeRefinedScheduleIntoStorage(storageUserKey, res, { targetTaskIds });
      clearSelectedBlocksContext();
      setPlannerSelectionContext(null);
      pushTimeline('Execution calendar updated from chat');
      setCalendarCoachHint(null);
    } catch (e) {
      pushTimeline(e instanceof Error ? e.message.slice(0, 80) : 'Calendar update failed');
    } finally {
      setCalendarCoachBusy(false);
    }
  }, [calendarCoachHint, navigate, pushTimeline, storageReady, storageUserKey]);

  const dismissPendingSuggestion = useCallback(async () => {
    lastDecisionSuggestionRef.current = null;
    if (!activeThreadId) {
      setPendingAction(null);
      return;
    }
    try {
      const res = await apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(activeThreadId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_action: 'dismiss_suggestion', message: '' }),
      });
      if (res.ok) {
        const data = (await res.json()) as { thread?: { pending_action?: PendingAction | null } };
        const pa = data.thread?.pending_action;
        setPendingAction(pa && typeof pa === 'object' && pa.type ? pa : null);
      } else {
        setPendingAction(null);
      }
    } catch {
      setPendingAction(null);
    }
  }, [activeThreadId]);

  const hasClarificationPending = pendingAction?.type === 'clarification';

  const onGenerateDecisionReport = useCallback(async () => {
    unlockSlimeAudioContext();
    if (hasClarificationPending) {
      pushTimeline('Answer or skip the clarification card below first');
      return;
    }
    const fromPending = decisionPromptFromPendingAction(pendingAction);
    const lastUser =
      fromPending ||
      messages.filter((m) => m.role === 'user').slice(-1)[0]?.content ||
      'Help me decide.';
    if (pendingAction?.type === 'decision_report') {
      await beginDecisionReportRef.current(lastUser);
      return;
    }
    const blockedByClarify = await requestClarifyIfNeeded(lastUser, 'report');
    if (!blockedByClarify) {
      await beginDecisionReportRef.current(lastUser);
    }
  }, [messages, hasClarificationPending, pendingAction, requestClarifyIfNeeded]);

  const hasReportArtifact = useMemo(
    () => messagesHaveDecisionReportArtifact(messages),
    [messages],
  );
  const isReportGenerating = reportStream.isStreaming;
  const dockPendingAction = useMemo(() => {
    if (!pendingAction) return null;
    if (pendingAction.type === 'decision_report' && (isReportGenerating || hasReportArtifact)) {
      return null;
    }
    return pendingAction;
  }, [pendingAction, isReportGenerating, hasReportArtifact]);
  const suggestion = useMemo(() => pendingActionToSuggestion(dockPendingAction), [dockPendingAction]);

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-4 py-6">
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
                  onOpenReportArtifact={onOpenReportArtifact}
                  onReviseArtifact={onReviseFromArtifactOrPanel}
                  onArtifactExecutionCalendar={openExecutionCalendar}
                  onSuggestionChip={(label) => setInputBootstrap(label)}
                />
                <div ref={bottomRef} />
              </div>
              <div className="mt-3 space-y-3 border-t border-gray-200/80 pt-3">
                {isReportGenerating && !reportOpen ? (
                  <div className="rounded-2xl border border-indigo-200/90 bg-gradient-to-br from-indigo-50/95 to-violet-50/80 px-4 py-3 shadow-[0_4px_20px_rgba(99,102,241,0.1)]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600"
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-indigo-950">Generating decision report</p>
                          <p className="truncate text-xs text-indigo-800/90">{reportStream.progressStep}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setReportOpen(true);
                          setAgentStatus('report_generating');
                        }}
                        className="shrink-0 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                      >
                        View progress
                      </button>
                    </div>
                  </div>
                ) : null}
                <ThreadActionDock
                  pendingAction={dockPendingAction}
                  disabled={sending || (hasClarificationPending && pendingClarifyAction?.kind === 'report')}
                  onGenerateDecisionReport={() => void onGenerateDecisionReport()}
                  onDismissSuggestion={() => void dismissPendingSuggestion()}
                  onClarifySkip={async () => {
                    unlockSlimeAudioContext();
                    const pending = pendingClarifyAction;
                    const clar = pendingAction?.type === 'clarification' ? pendingAction : null;
                    const q0 = clar?.payload?.questions;
                    const firstQ = Array.isArray(q0) && q0.length ? (q0[0] as ClarifyQuestion) : null;
                    const meta = clar?.payload?.meta as ClarificationGateMeta | undefined;
                    const dim = (meta?.target_dimension || firstQ?.id || '').trim();
                    const qp = firstQ?.prompt ?? '';
                    setPendingAction(null);
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
                  onClarifyAnswer={(answers, saveToProfile) => {
                    const pending = pendingClarifyAction;
                    setPendingAction(null);
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
                {calendarCoachHint ? (
                  <div className="relative overflow-hidden rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-white/95 via-indigo-50/40 to-violet-50/50 px-3 py-3 shadow-[0_8px_30px_rgba(99,102,241,0.12)]">
                    <BuddyTooltip content="Dismiss this calendar hint card.">
                      <button
                        type="button"
                        className="absolute right-2 top-2 rounded-full p-1 text-slate-400 hover:bg-white/80 hover:text-slate-700"
                        aria-label="Dismiss calendar hint"
                        onClick={() => setCalendarCoachHint(null)}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </BuddyTooltip>
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
                        <BuddyTooltip content="Clear the narrowed planner scope and apply hints to the whole calendar again.">
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
                        </BuddyTooltip>
                      </div>
                    ) : null}
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <BuddyTooltip content="Apply this calendar suggestion to your execution planner storage.">
                        <button
                          type="button"
                          disabled={calendarCoachBusy}
                          onClick={() => void applyCalendarCoachFromChat()}
                          className="rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50"
                        >
                          {calendarCoachBusy ? 'Applying…' : 'Apply to execution calendar'}
                        </button>
                      </BuddyTooltip>
                      <BuddyTooltip content="Open the execution planner in another view with this hint prefilled.">
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
                      </BuddyTooltip>
                    </div>
                  </div>
                ) : null}
                {!activeThreadId ? (
                  <p className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
                    Starting a fresh chat for you…
                  </p>
                ) : null}
                <div className="mb-2">
                  <ModelSelector
                    feature="shadow_chat"
                    selectedModelId={modelOptionId || slimeModels.defaultModel}
                    onChange={setModelOptionId}
                    models={slimeModels.models}
                    selectorEnabled={slimeModels.selectorEnabled}
                    showCostPreview
                    variant="compact"
                    label="Slime model"
                    hint="Little tier is the default (lowest credits). Upgrade per message thread."
                    disabled={sending}
                  />
                </div>
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
              generateReportDisabled={sending || (hasClarificationPending && pendingClarifyAction?.kind === 'report')}
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
        degradedWarnings={reportStream.degradedWarnings}
        onRetryStage={() => {
          void reportStream.retryFromCurrentStage();
        }}
        onClose={() => {
          setReportOpen(false);
          if (reportStream.isStreaming) {
            setAgentStatus('report_generating');
          } else {
            setAgentStatus('idle');
          }
        }}
        onContinueChat={() => {
          setReportOpen(false);
          if (reportStream.isStreaming) {
            setAgentStatus('report_generating');
          } else {
            setAgentStatus('idle');
          }
        }}
        onOpenExecutionCalendar={(decisionId) => {
          openExecutionCalendar(decisionId);
          setReportOpen(false);
          setAgentStatus('idle');
        }}
        onReviseReport={(decisionId) => void onReviseFromArtifactOrPanel(decisionId)}
        shadowThreadId={activeThreadId}
      />
      <ProfileMemoryToastStack
        toasts={profileMemoryToasts}
        onDismiss={dismissProfileMemoryToast}
        onDelete={deleteProfileMemoryFromToast}
        onEdit={openProfileMemoryEditor}
      />
    </div>
  );
}
