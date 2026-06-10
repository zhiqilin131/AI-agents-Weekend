import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Pencil, Trash2 } from 'lucide-react';
import { cn } from '../app/components/ui/utils';
import type { SlimeAdvisorState } from '../app/components/report/SlimeAdvisor';
import { ThreadActionDock } from '../app/components/shadow/ThreadActionDock';
import { MainNavButtons } from '../app/components/MainNavButtons';
import {
  decisionPromptFromPendingAction,
  pendingActionToSuggestion,
  shouldSurfaceDecisionReportPending,
  type PendingAction,
} from '../app/components/shadow/pendingActionTypes';
import { DecisionReportStreamingPanel } from '../app/components/shadow/DecisionReportStreamingPanel';
import type { ShadowSuggestion } from '../app/components/shadow/types';
import { BuddyRecentChatPanel } from '../features/slime/BuddyRecentChatPanel';
import { BuddyRecentTherapyPanel } from '../features/slime/BuddyRecentTherapyPanel';
import { BuddyLongThreadBanner } from '../features/slime/BuddyLongThreadBanner';
import {
  buddyThreadMessageCount,
  dismissLongThreadBanner,
  isBuddyThreadLong,
  isLongThreadBannerDismissed,
} from '../features/slime/buddyThreadLimits';
import { TherapyReportPanel } from '../features/slime/TherapyReportPanel';
import { RimumuWellbeingIntakeDialog } from '../features/slime/RimumuWellbeingIntakeDialog';
import {
  RimumuIntroductionDialog,
  RimumuIntroductionTrigger,
} from '../features/slime/RimumuIntroductionDialog';
import type { TherapyReport } from '../features/slime/therapySession';
import {
  canUseWellbeingBuddyVoice,
  therapyReportFromMessages,
  therapyStatusFromThread,
  wellbeingBuddyGateHint,
} from '../features/slime/therapySession';
import { postTherapyStart } from '../features/slime/therapySessionApi';
import { TherapyBuddyTopRail } from '../features/slime/TherapyBuddyTopRail';
import type { WellbeingMemorySavedPayload } from '../features/slime/RimumuWellbeingIntakeDialog';
import {
  ProfileMemoryToastStack,
  type ProfileMemoryToast,
} from '../app/components/shadow/ProfileMemoryToastStack';
import type { ShadowThread } from '../app/components/shadow/types';
import { SlimeCompanionStage } from '../features/slime/SlimeCompanionStage';
import type { SlimeDecisionSuggestion, SlimeSpeechOutput } from '../features/slime/SlimeVoiceAgent';
import { BuddyTooltip } from '../features/slime/BuddyTooltip';
import { SlimeVoiceAgent } from '../features/slime/SlimeVoiceAgent';
import { EvidenceDrawer } from '../app/components/profile/EvidenceDrawer';
import type { MemoryEvidenceItem } from '../app/components/profile/memoryEvidenceTypes';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_SLIME_PROFILE, useSlimeProfile } from '../hooks/useSlimeProfile';
import { useDecisionReportStream } from '../hooks/useDecisionReportStream';
import { apiFetch } from '../utils/apiFetch';
import { SLIME_CALENDAR_BRIEF_CONTEXT_KEY } from '../utils/executionStorageKeys';
import { unlockSlimeAudioContext } from '../utils/slimeAudioContext';
import {
  buddyPageCanvasBackground,
  getSlimeIdentity,
  nextSlimeType,
  normalizeSlimeType,
  slimeSupportsDecisionMode,
  type SlimeType,
} from '../features/slime/slimeIdentity';
import { slimeTypeFromThread } from '../utils/patchThreadSlimeType';
import { BUDDY_RAIL_LEFT_FALLBACK, BUDDY_TOPBAR_CLEARANCE } from '../features/slime/buddyLayout';
import { buddyCompanionSwitchChrome } from '../features/slime/buddyRailChrome';
import { useSlimeSpeakAmplitude } from '../features/slime/visual3d/slimeSpeakAmplitude';
import { isDraftThread, listDraftThreads, resolveThreadSlimeType } from '../features/slime/newChatGuard';

/** Legacy single-key storage; per-user keys are ``${prefix}:${supabaseUserId}``. */
const BUDDY_THREAD_STORAGE_PREFIX = 'slimeBuddyShadowThreadId';
const BUDDY_THERAPY_THREAD_STORAGE_PREFIX = 'slimeBuddyTherapyThreadId';
const BUDDY_COMPANION_PREF_PREFIX = 'slimeBuddyActiveCompanion';

function buddyCompanionPrefKey(userId: string | null | undefined): string | null {
  const u = userId?.trim();
  if (!u) return null;
  return `${BUDDY_COMPANION_PREF_PREFIX}:${u}`;
}

function readBuddyCompanionPref(userId: string | null | undefined): SlimeType {
  const k = buddyCompanionPrefKey(userId);
  if (!k) return 'generalized';
  try {
    return normalizeSlimeType(localStorage.getItem(k)) ?? 'generalized';
  } catch {
    return 'generalized';
  }
}

function writeBuddyCompanionPref(userId: string | null | undefined, slimeType: SlimeType): void {
  const k = buddyCompanionPrefKey(userId);
  if (!k) return;
  try {
    localStorage.setItem(k, slimeType);
  } catch {
    /* ignore */
  }
}

function buddyThreadStorageKey(
  userId: string | null | undefined,
  slimeType: SlimeType = 'generalized',
): string | null {
  const u = userId?.trim();
  if (!u) return null;
  const prefix =
    slimeType === 'wellbeing' ? BUDDY_THERAPY_THREAD_STORAGE_PREFIX : BUDDY_THREAD_STORAGE_PREFIX;
  return `${prefix}:${u}`;
}

type BuddyCornerToast = {
  message: string;
  tone: 'memory_saved' | 'memory_retrieved' | 'neutral' | 'error';
  details?: Array<{ action?: string; id?: string; text?: string; category?: string }>;
};

export default function SlimeCompanionPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useAuth();
  const authUserId = session?.user?.id ?? null;
  const { slimeProfile, updateSlimeProfile } = useSlimeProfile();
  const [slimeDraft, setSlimeDraft] = useState(DEFAULT_SLIME_PROFILE);
  const [buddyCornerToast, setBuddyCornerToast] = useState<BuddyCornerToast | null>(null);
  const buddyCornerToastTimerRef = useRef<number | null>(null);
  const [advisorState, setAdvisorState] = useState<SlimeAdvisorState>('idle');
  const [speechOutput, setSpeechOutput] = useState<SlimeSpeechOutput | null>(null);
  const [evidenceDrawerItems, setEvidenceDrawerItems] = useState<MemoryEvidenceItem[]>([]);
  const [evidenceDrawerOpen, setEvidenceDrawerOpen] = useState(false);
  const [flaggedEvidenceIds, setFlaggedEvidenceIds] = useState<Set<string>>(() => new Set());
  const [buddyThreadId, setBuddyThreadId] = useState<string | null>(null);
  const [buddyActiveThread, setBuddyActiveThread] = useState<ShadowThread | null>(null);
  const [dismissedLongHintFor, setDismissedLongHintFor] = useState<string | null>(null);
  const [buddySlimeType, setBuddySlimeType] = useState<SlimeType>(() =>
    readBuddyCompanionPref(authUserId),
  );
  const [wellbeingIntakeOpen, setWellbeingIntakeOpen] = useState(false);
  const [rimumuIntroOpen, setRimumuIntroOpen] = useState(false);
  const [therapyReportOpen, setTherapyReportOpen] = useState(false);
  const [therapyReport, setTherapyReport] = useState<TherapyReport | null>(null);
  const intakePromptThreadRef = useRef<string | null>(null);
  const [buddyRecapRefresh, setBuddyRecapRefresh] = useState(0);
  const speakAmplitude = useSlimeSpeakAmplitude();
  const [profileMemoryToasts, setProfileMemoryToasts] = useState<ProfileMemoryToast[]>([]);
  const profileMemoryToastTimersRef = useRef<Map<string, number>>(new Map());
  const [pendingDecision, setPendingDecision] = useState<SlimeDecisionSuggestion | null>(null);
  const [buddyPendingAction, setBuddyPendingAction] = useState<PendingAction | null>(null);
  const [creatingBuddyChat, setCreatingBuddyChat] = useState(false);
  const [creatingBuddyTherapy, setCreatingBuddyTherapy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [decisionModeManual, setDecisionModeManual] = useState(false);
  const reportStream = useDecisionReportStream();

  const persistThreadId = useCallback(
    (id: string, slimeType: SlimeType = buddySlimeType) => {
      setBuddyThreadId(id);
      setBuddyRecapRefresh((n) => n + 1);
      const k = buddyThreadStorageKey(authUserId, slimeType);
      if (!k) return;
      try {
        localStorage.setItem(k, id);
      } catch {
        /* ignore */
      }
    },
    [authUserId, buddySlimeType],
  );

  const loadBuddyThreadMeta = useCallback(
    async (tid: string, options?: { syncCompanionFromThread?: boolean }) => {
    try {
      const res = await apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(tid)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { thread?: ShadowThread };
      if (!data.thread) return;
      const threadType = slimeTypeFromThread(data.thread);
      if (options?.syncCompanionFromThread) {
        setBuddySlimeType(threadType);
        writeBuddyCompanionPref(authUserId, threadType);
      } else if (threadType !== buddySlimeType) {
        return;
      }
      setBuddyActiveThread(data.thread);
      const rep =
        (data.thread.therapy_session?.report as TherapyReport | undefined) ??
        therapyReportFromMessages(data.thread.messages);
      if (rep) setTherapyReport(rep);
    } catch {
      /* ignore */
    }
  },
    [authUserId, buddySlimeType],
  );

  const activateBuddyThread = useCallback(
    (
      thread: ShadowThread,
      slimeType: SlimeType,
      options?: { syncCompanionFromThread?: boolean; openWellbeingIntake?: boolean },
    ) => {
      const resolvedType = options?.syncCompanionFromThread ? resolveThreadSlimeType(thread) : slimeType;
      writeBuddyCompanionPref(authUserId, resolvedType);
      setBuddySlimeType(resolvedType);
      setBuddyActiveThread(thread);
      const rep =
        (thread.therapy_session?.report as TherapyReport | undefined) ??
        therapyReportFromMessages(thread.messages);
      if (rep) setTherapyReport(rep);
      persistThreadId(thread.thread_id, resolvedType);
      if (options?.openWellbeingIntake && resolvedType === 'wellbeing') {
        setWellbeingIntakeOpen(true);
      }
      void loadBuddyThreadMeta(thread.thread_id, { syncCompanionFromThread: options?.syncCompanionFromThread });
    },
    [authUserId, loadBuddyThreadMeta, persistThreadId],
  );

  const loadBuddyThreads = useCallback(async (): Promise<ShadowThread[]> => {
    const res = await apiFetch('/api/shadow-chat/threads');
    if (!res.ok) return [];
    const data = (await res.json()) as { threads?: ShadowThread[] };
    return data.threads || [];
  }, []);

  const startNewTherapy = useCallback(async () => {
    if (creatingBuddyTherapy) return;
    setCreatingBuddyTherapy(true);
    try {
      if (buddyActiveThread && isDraftThread(buddyActiveThread, 'wellbeing')) {
        activateBuddyThread(buddyActiveThread, 'wellbeing', {
          syncCompanionFromThread: true,
          openWellbeingIntake: true,
        });
        return;
      }
      const threads = await loadBuddyThreads();
      const staleDraftIds = listDraftThreads(threads, 'wellbeing')
        .map((t) => t.thread_id)
        .filter((id) => id && id !== buddyThreadId);
      const res = await apiFetch('/api/shadow-chat/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slime_type: 'wellbeing', title: 'Therapy session' }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { thread?: ShadowThread };
      if (!data.thread?.thread_id) return;
      activateBuddyThread(data.thread, 'wellbeing', {
        syncCompanionFromThread: true,
        openWellbeingIntake: true,
      });
      void Promise.allSettled(
        staleDraftIds
          .filter((id) => id !== data.thread?.thread_id)
          .map((id) => apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(id)}`, { method: 'DELETE' })),
      ).then(() => setBuddyRecapRefresh((n) => n + 1));
    } finally {
      setCreatingBuddyTherapy(false);
    }
  }, [activateBuddyThread, buddyActiveThread, buddyThreadId, creatingBuddyTherapy, loadBuddyThreads]);

  const startNewBuddyChat = useCallback(async () => {
    if (creatingBuddyChat) return;
    setCreatingBuddyChat(true);
    try {
      if (buddyActiveThread && isDraftThread(buddyActiveThread, 'generalized')) {
        activateBuddyThread(buddyActiveThread, 'generalized', { syncCompanionFromThread: true });
        return;
      }
      const threads = await loadBuddyThreads();
      const staleDraftIds = listDraftThreads(threads, 'generalized')
        .map((t) => t.thread_id)
        .filter((id) => id && id !== buddyThreadId);
      const res = await apiFetch('/api/shadow-chat/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slime_type: 'generalized', title: 'New chat' }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { thread?: ShadowThread };
      if (!data.thread?.thread_id) return;
      activateBuddyThread(data.thread, 'generalized', { syncCompanionFromThread: true });
      void Promise.allSettled(
        staleDraftIds
          .filter((id) => id !== data.thread?.thread_id)
          .map((id) => apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(id)}`, { method: 'DELETE' })),
      ).then(() => setBuddyRecapRefresh((n) => n + 1));
    } finally {
      setCreatingBuddyChat(false);
    }
  }, [activateBuddyThread, buddyActiveThread, buddyThreadId, creatingBuddyChat, loadBuddyThreads]);

  const openBuddyChat = useCallback(() => {
    const tid = buddyThreadId?.trim();
    const slimeQ = buddySlimeType === 'wellbeing' ? '&slime=wellbeing' : '';
    if (tid) {
      navigate(`/chat?thread=${encodeURIComponent(tid)}${slimeQ}`);
      return;
    }
    navigate(buddySlimeType === 'wellbeing' ? '/chat?slime=wellbeing' : '/chat');
  }, [buddyThreadId, buddySlimeType, navigate]);

  const onBuddyConversationUpdated = useCallback((updatedThreadId?: string) => {
    setBuddyRecapRefresh((n) => n + 1);
    const tid = updatedThreadId?.trim() || buddyThreadId?.trim();
    if (tid) void loadBuddyThreadMeta(tid);
  }, [buddyThreadId, loadBuddyThreadMeta]);

  const onBuddyThreadTitleUpdated = useCallback(
    (title: string, threadId: string) => {
      setBuddyActiveThread((prev) =>
        prev && prev.thread_id === threadId ? { ...prev, title } : prev,
      );
      setBuddyRecapRefresh((n) => n + 1);
    },
    [],
  );

  const dismissProfileMemoryToast = useCallback((id: string) => {
    const t = profileMemoryToastTimersRef.current.get(id);
    if (t != null) window.clearTimeout(t);
    profileMemoryToastTimersRef.current.delete(id);
    setProfileMemoryToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const scheduleProfileMemoryToast = useCallback(
    (payload: WellbeingMemorySavedPayload | { message: string; items: string[]; details?: ProfileMemoryToast['details']; at?: string }) => {
      const id = `pm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const at = (payload.at || new Date().toISOString()).trim();
      const items = payload.items?.length ? payload.items : [payload.message || 'Memory saved'];
      const details =
        payload.details?.length ?
          payload.details
        : items.map((text) => ({ text, category: 'wellbeing', action: 'new' as const }));
      setProfileMemoryToasts((prev) => [...prev.slice(-4), { id, items, at, details }]);
      const timer = window.setTimeout(() => dismissProfileMemoryToast(id), 6200);
      profileMemoryToastTimersRef.current.set(id, timer);
    },
    [dismissProfileMemoryToast],
  );

  const beginBuddyTherapyAfterIntake = useCallback(
    async (tid: string) => {
      const result = await postTherapyStart(tid);
      if (!result.ok) {
        if (result.needsIntake) setWellbeingIntakeOpen(true);
        return;
      }
      setBuddyActiveThread(result.thread);
      setBuddyRecapRefresh((n) => n + 1);
    },
    [],
  );

  const wellbeingVoiceGateHint =
    buddySlimeType === 'wellbeing'
      ? wellbeingBuddyGateHint(Boolean(buddyThreadId), buddyActiveThread)
      : null;
  const wellbeingVoiceGated =
    buddySlimeType === 'wellbeing' && !canUseWellbeingBuddyVoice(buddyActiveThread);

  const buddyMessageCount = buddyThreadMessageCount(buddyActiveThread);
  const showLongThreadBanner = useMemo(() => {
    const tid = buddyThreadId?.trim();
    if (!tid || buddyActiveThread?.thread_id !== tid) return false;
    if (dismissedLongHintFor === tid) return false;
    if (isLongThreadBannerDismissed(authUserId, tid)) return false;
    return isBuddyThreadLong(buddyActiveThread);
  }, [authUserId, buddyActiveThread, buddyThreadId, dismissedLongHintFor]);

  useEffect(() => {
    if (buddySlimeType !== 'wellbeing' || !buddyActiveThread?.thread_id) return;
    const tid = buddyActiveThread.thread_id.trim();
    if (!tid || buddyThreadId?.trim() !== tid) return;
    if (slimeTypeFromThread(buddyActiveThread) !== 'wellbeing') return;
    const intakeDone =
      buddyActiveThread.therapy_session?.intake_complete ??
      buddyActiveThread.wellbeing_session?.intake_complete;
    const status = therapyStatusFromThread(buddyActiveThread);
    if (intakeDone || status === 'ended') return;
    if (intakePromptThreadRef.current === tid) return;
    intakePromptThreadRef.current = tid;
    setWellbeingIntakeOpen(true);
  }, [buddyActiveThread, buddySlimeType, buddyThreadId]);

  useEffect(() => {
    setWellbeingIntakeOpen(false);
    intakePromptThreadRef.current = null;
    setBuddyActiveThread(null);

    const k = buddyThreadStorageKey(authUserId, buddySlimeType);
    if (!k) {
      setBuddyThreadId(null);
      return;
    }
    try {
      const tid = localStorage.getItem(k);
      setBuddyThreadId(tid);
      if (tid) void loadBuddyThreadMeta(tid);
      else setTherapyReport(null);
    } catch {
      setBuddyThreadId(null);
    }
  }, [authUserId, buddySlimeType, loadBuddyThreadMeta]);

  const flashBuddyCornerToast = useCallback((
    message: string,
    tone: BuddyCornerToast['tone'],
    details?: BuddyCornerToast['details'],
  ) => {
    if (buddyCornerToastTimerRef.current != null) {
      window.clearTimeout(buddyCornerToastTimerRef.current);
      buddyCornerToastTimerRef.current = null;
    }
    setBuddyCornerToast({ message, tone, details });
    buddyCornerToastTimerRef.current = window.setTimeout(() => {
      setBuddyCornerToast(null);
      buddyCornerToastTimerRef.current = null;
    }, 3800);
  }, []);

  const applyBuddyCompanionSwitch = useCallback(
    (next: SlimeType) => {
      if (next === buddySlimeType) return;
      writeBuddyCompanionPref(authUserId, next);
      setBuddySlimeType(next);
      setWellbeingIntakeOpen(false);
      intakePromptThreadRef.current = null;
      setBuddyActiveThread(null);
      setSpeechOutput(null);
      setPendingDecision(null);
      setDecisionModeManual(false);
      setBuddyPendingAction(null);
      setReportOpen(false);
      flashBuddyCornerToast(`Switched to ${getSlimeIdentity(next).displayName}`, 'neutral');
    },
    [authUserId, buddySlimeType, flashBuddyCornerToast],
  );

  const toggleBuddyCompanion = useCallback(() => {
    applyBuddyCompanionSwitch(nextSlimeType(buddySlimeType));
  }, [applyBuddyCompanionSwitch, buddySlimeType]);

  const deleteMemoryFromBuddyToast = useCallback(async (factId: string) => {
    if (!factId.trim()) return;
    try {
      const res = await apiFetch(`/api/profile/memory-fact/${encodeURIComponent(factId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      flashBuddyCornerToast('Removed that memory.', 'neutral');
    } catch {
      flashBuddyCornerToast('Could not delete that memory right now.', 'error');
    }
  }, [flashBuddyCornerToast]);

  const flagEvidenceWrong = useCallback((item: MemoryEvidenceItem) => {
    setFlaggedEvidenceIds((prev) => new Set(prev).add(item.id));
    flashBuddyCornerToast('Marked that memory as questionable for this answer.', 'neutral');
  }, [flashBuddyCornerToast]);

  const editEvidenceMemory = useCallback((item: MemoryEvidenceItem) => {
    const fid = (item.sourceId || '').trim();
    if (!fid || item.type !== 'profile') {
      flashBuddyCornerToast('This evidence came from chat context, so edit it from the original chat.', 'neutral');
      return;
    }
    setEvidenceDrawerOpen(false);
    navigate(`/profile?memory=${encodeURIComponent(fid)}`);
  }, [flashBuddyCornerToast, navigate]);

  const deleteEvidenceMemory = useCallback(async (item: MemoryEvidenceItem) => {
    const fid = (item.sourceId || '').trim();
    if (!fid || item.type !== 'profile') {
      setEvidenceDrawerItems((prev) => prev.filter((x) => x.id !== item.id));
      flashBuddyCornerToast('Hidden for this answer. I can only delete saved profile memories directly.', 'neutral');
      return;
    }
    try {
      const res = await apiFetch(`/api/profile/memory-fact/${encodeURIComponent(fid)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      setEvidenceDrawerItems((prev) => prev.filter((x) => x.id !== item.id));
      flashBuddyCornerToast('Removed that saved memory.', 'neutral');
    } catch {
      flashBuddyCornerToast('Could not remove that memory right now.', 'error');
    }
  }, [flashBuddyCornerToast]);

  useEffect(
    () => () => {
      if (buddyCornerToastTimerRef.current != null) {
        window.clearTimeout(buddyCornerToastTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const tid = buddyThreadId?.trim();
    if (!tid) {
      setBuddyPendingAction(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(tid)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { thread?: { pending_action?: PendingAction } };
        const pa = data.thread?.pending_action;
        if (pa && typeof pa === 'object' && pa.type) {
          setBuddyPendingAction(pa);
        } else if (!cancelled) {
          setBuddyPendingAction(null);
        }
      } catch {
        if (!cancelled) setBuddyPendingAction(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buddyThreadId, buddyRecapRefresh]);

  const buddyDecisionSuggestion: ShadowSuggestion | null = slimeSupportsDecisionMode(buddySlimeType)
    ? pendingActionToSuggestion(buddyPendingAction) ??
      (pendingDecision?.should_show
        ? {
            type: 'decision_report',
            title: pendingDecision.display_text?.trim() || 'Turn this into a decision report?',
            message:
              pendingDecision.description?.trim() ||
              'I can structure this into options, trade-offs, risks, consequences, and an action plan.',
          }
        : null)
    : null;

  const dismissBuddyDecisionSuggestion = useCallback(async () => {
    setPendingDecision(null);
    const tid = buddyThreadId?.trim();
    if (!tid) {
      setBuddyPendingAction(null);
      return;
    }
    try {
      const res = await apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(tid)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_action: 'dismiss_suggestion', message: '' }),
      });
      if (res.ok) {
        const data = (await res.json()) as { thread?: { pending_action?: PendingAction | null } };
        const pa = data.thread?.pending_action;
        setBuddyPendingAction(pa && typeof pa === 'object' && pa.type ? pa : null);
      } else {
        setBuddyPendingAction(null);
      }
    } catch {
      setBuddyPendingAction(null);
    }
  }, [buddyThreadId]);

  const startDecisionReportFlow = async (prompt: string) => {
    const tid = buddyThreadId;
    if (!tid?.trim()) {
      flashBuddyCornerToast('No chat thread yet — speak once first so I can link the report.', 'error');
      return;
    }
    unlockSlimeAudioContext();
    const p = prompt.trim() || 'Help me decide.';
    setPendingDecision(null);
    setBuddyPendingAction(null);
    setReportOpen(true);
    const { error } = await reportStream.start({ threadId: tid, decisionPrompt: p });
    setPendingDecision(null);
    setBuddyPendingAction(null);
    if (error === 'insufficient_credits') {
      setReportOpen(false);
      return;
    }
    if (error && error !== 'cancelled') {
      flashBuddyCornerToast(error.length > 120 ? `${error.slice(0, 120)}…` : error, 'error');
      return;
    }
    try {
      const res = await apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(tid)}`);
      if (res.ok) {
        const data = (await res.json()) as { thread?: { pending_action?: PendingAction } };
        const pa = data.thread?.pending_action;
        setBuddyPendingAction(pa && typeof pa === 'object' && pa.type ? pa : null);
      }
    } catch {
      /* keep cleared */
    }
  };

  useEffect(() => {
    setSlimeDraft(slimeProfile);
  }, [slimeProfile]);

  useEffect(() => {
    if (searchParams.get('slime') === 'wellbeing') {
      writeBuddyCompanionPref(authUserId, 'wellbeing');
      setBuddySlimeType('wellbeing');
    }
  }, [authUserId, searchParams]);

  useEffect(() => {
    setBuddySlimeType(readBuddyCompanionPref(authUserId));
  }, [authUserId]);

  useEffect(() => {
    if (searchParams.get('personalize') !== '1') return;
    flashBuddyCornerToast('Companion switch moved to the left rail.', 'neutral');
    const next = new URLSearchParams(searchParams);
    next.delete('personalize');
    setSearchParams(next, { replace: true });
  }, [flashBuddyCornerToast, searchParams, setSearchParams]);

  useEffect(() => {
    if (searchParams.get('calendar') !== '1') return;
    let title = 'Calendar context loaded.';
    try {
      const raw = sessionStorage.getItem(SLIME_CALENDAR_BRIEF_CONTEXT_KEY);
      const parsed = raw ? (JSON.parse(raw) as { headline?: string }) : null;
      if (parsed?.headline) title = parsed.headline;
    } catch {
      /* ignore */
    }
    flashBuddyCornerToast(title, 'neutral');
    const next = new URLSearchParams(searchParams);
    next.delete('calendar');
    setSearchParams(next, { replace: true });
  }, [flashBuddyCornerToast, searchParams, setSearchParams]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const { documentElement, body } = document;
    const prevHtmlOverflow = documentElement.style.overflow;
    const prevHtmlOverscroll = documentElement.style.overscrollBehavior;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyOverscroll = body.style.overscrollBehavior;

    // Buddy is a fixed-surface layout; lock page scroll to avoid wheel drift.
    documentElement.style.overflow = 'hidden';
    documentElement.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';

    return () => {
      documentElement.style.overflow = prevHtmlOverflow;
      documentElement.style.overscrollBehavior = prevHtmlOverscroll;
      body.style.overflow = prevBodyOverflow;
      body.style.overscrollBehavior = prevBodyOverscroll;
    };
  }, []);

  const buddyIntakeBlockingUi =
    wellbeingIntakeOpen && buddySlimeType === 'wellbeing' && Boolean(buddyThreadId?.trim());

  const buddyFlowModalOpen =
    buddyIntakeBlockingUi || rimumuIntroOpen || therapyReportOpen;

  const buddyIdent = getSlimeIdentity(buddySlimeType);
  const buddyCanvasBg = buddyPageCanvasBackground(buddySlimeType);
  const [buddyRailTop, setBuddyRailTop] = useState<string>(
    `calc(${BUDDY_TOPBAR_CLEARANCE} + 3rem)`,
  );
  const [buddyRailLeft, setBuddyRailLeft] = useState<string>(BUDDY_RAIL_LEFT_FALLBACK);
  const buddyRailMaxHeight = `calc(100dvh - ${buddyRailTop} - env(safe-area-inset-bottom,0px))`;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    let raf: number | null = null;
    let ro: ResizeObserver | null = null;

    const fallbackTop = `calc(${BUDDY_TOPBAR_CLEARANCE} + 3rem)`;
    const measure = () => {
      const topbar = document.querySelector<HTMLElement>('[data-main-nav-topbar]');
      if (!topbar) {
        setBuddyRailTop((prev) => (prev === fallbackTop ? prev : fallbackTop));
      } else {
        const nextTop = `${Math.ceil(topbar.getBoundingClientRect().bottom + 16)}px`;
        setBuddyRailTop((prev) => (prev === nextTop ? prev : nextTop));
      }

      const align =
        document.querySelector<HTMLElement>('[data-buddy-rail-align]') ??
        topbar;
      if (align) {
        const nextLeft = `${Math.max(0, Math.floor(align.getBoundingClientRect().left))}px`;
        setBuddyRailLeft((prev) => (prev === nextLeft ? prev : nextLeft));
      }
    };
    const schedule = () => {
      if (raf != null) window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(measure);
    };

    schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.visualViewport?.addEventListener('resize', schedule);

    const topbar = document.querySelector<HTMLElement>('[data-main-nav-topbar]');
    if (topbar && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule);
      ro.observe(topbar);
    }

    return () => {
      if (raf != null) window.cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  }, []);

  return (
    <>
    <SlimeVoiceAgent
      slimeProfile={slimeDraft}
      slimeType={buddySlimeType}
      currentRoute="/buddy"
      voiceGateDisabled={wellbeingVoiceGated}
      voiceGateMessage={wellbeingVoiceGateHint}
      threadId={buddyThreadId ?? undefined}
      onThreadId={persistThreadId}
      onDecisionSuggestion={setPendingDecision}
      onAdvisorStateChange={setAdvisorState}
      onSpeechOutputChange={setSpeechOutput}
      onMemoryEvidenceItemsChange={(items) => {
        setEvidenceDrawerItems(items);
        setFlaggedEvidenceIds(new Set());
        if (!items.length) setEvidenceDrawerOpen(false);
      }}
      onProfileMemorySaved={(payload) => {
        if (buddySlimeType === 'wellbeing') {
          scheduleProfileMemoryToast({
            message: payload.message,
            items: payload.items,
            at: new Date().toISOString(),
            details: (payload.details || []).map((d) => ({
              ...d,
              category: d.category || 'wellbeing',
            })),
          });
          return;
        }
        flashBuddyCornerToast(payload.message, 'memory_saved', payload.details || []);
      }}
      onMemoryEvidenceRetrieved={(count) =>
        flashBuddyCornerToast(
          count === 1 ? 'Retrieved 1 related memory' : `Retrieved ${count} related memories`,
          'memory_retrieved',
        )
      }
      onUpdateSlimeProfile={async (patch) => {
        const next = await updateSlimeProfile(patch);
        setSlimeDraft(next);
      }}
      onConversationUpdated={onBuddyConversationUpdated}
      onThreadTitleUpdated={onBuddyThreadTitleUpdated}
      decisionModeActive={slimeSupportsDecisionMode(buddySlimeType) && decisionModeManual}
      onToggleDecisionMode={
        slimeSupportsDecisionMode(buddySlimeType)
          ? () => setDecisionModeManual((v) => !v)
          : undefined
      }
      decisionModeToggleDisabled={reportStream.isStreaming}
    />
    <motion.div
      className="relative min-h-[100dvh] min-w-0 overflow-x-clip"
      style={{ background: buddyCanvasBg.base }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.28]"
        style={{ background: buddyCanvasBg.overlay }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/72 to-transparent" />

      <div className="relative z-[60]">
        <MainNavButtons layout="topbar" className="!mb-0" hideSignOut />
      </div>

      <aside
        data-slime-avoid
        data-testid="buddy-left-rail"
        className={cn(
          'pointer-events-auto fixed z-[58] flex min-h-0 flex-col gap-2',
          'w-[min(17.5rem,calc(100vw-2rem-env(safe-area-inset-left,0px)))] sm:w-72',
          buddyFlowModalOpen && 'pointer-events-none opacity-40',
        )}
        style={{ top: buddyRailTop, left: buddyRailLeft, maxHeight: buddyRailMaxHeight }}
      >
        <motion.div
          data-testid="buddy-left-rail-actions"
          className="flex shrink-0 flex-col gap-2"
        >
          <BuddyTooltip
            side="right"
            content="Choose your companion. Left is Mochi, right is Rimumu."
          >
            <div
              data-testid="buddy-companion-switch"
              className="grid w-full grid-cols-2 gap-1 rounded-2xl border p-1 backdrop-blur-xl"
              style={buddyCompanionSwitchChrome(buddySlimeType, buddyIdent.theme)}
            >
              <button
                type="button"
                onClick={() => applyBuddyCompanionSwitch('generalized')}
                aria-pressed={buddySlimeType === 'generalized'}
                className={cn(
                  'rounded-xl px-3 py-2 text-xs font-semibold transition',
                  buddySlimeType === 'generalized'
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'text-slate-600 hover:bg-white/70',
                )}
              >
                Mochi
              </button>
              <button
                type="button"
                onClick={() => applyBuddyCompanionSwitch('wellbeing')}
                aria-pressed={buddySlimeType === 'wellbeing'}
                className={cn(
                  'rounded-xl px-3 py-2 text-xs font-semibold transition',
                  buddySlimeType === 'wellbeing'
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'text-slate-600 hover:bg-white/70',
                )}
              >
                Rimumu
              </button>
            </div>
          </BuddyTooltip>

          {buddySlimeType === 'wellbeing' ? (
            <BuddyTooltip content="How Rimumu works — evidence-informed psychology, session flow, and what she can help with.">
              <RimumuIntroductionTrigger variant="rail" onClick={() => setRimumuIntroOpen(true)} />
            </BuddyTooltip>
          ) : null}
        </motion.div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {buddySlimeType === 'wellbeing' ? (
            <BuddyRecentTherapyPanel
              embedded
              className={cn(buddyFlowModalOpen && 'opacity-40 pointer-events-none')}
              activeThreadId={buddyThreadId}
              storageUserId={authUserId}
              refreshKey={buddyRecapRefresh}
              creatingNewTherapy={creatingBuddyTherapy}
              onSelectThread={(id) => {
                persistThreadId(id, 'wellbeing');
                void loadBuddyThreadMeta(id, { syncCompanionFromThread: true });
              }}
              onStartNewTherapy={() => void startNewTherapy()}
              onOpenFullChat={openBuddyChat}
            />
          ) : (
            <BuddyRecentChatPanel
              embedded
              className={cn(buddyFlowModalOpen && 'opacity-40 pointer-events-none')}
              activeThreadId={buddyThreadId}
              storageUserId={authUserId}
              refreshKey={buddyRecapRefresh}
              creatingNewChat={creatingBuddyChat}
              onSelectThread={(id) => {
                persistThreadId(id, 'generalized');
                void loadBuddyThreadMeta(id, { syncCompanionFromThread: true });
              }}
              onStartNewChat={() => void startNewBuddyChat()}
              onOpenFullChat={openBuddyChat}
            />
          )}
        </div>
      </aside>

      {buddySlimeType === 'wellbeing' ? (
        <aside
          data-slime-avoid
          className={cn(
            'pointer-events-none fixed z-[48] hidden sm:block',
            'right-[max(0.75rem,env(safe-area-inset-right,0px))]',
            'w-[min(17rem,calc(100vw-1.5rem-env(safe-area-inset-right,0px)))]',
            buddyFlowModalOpen && 'pointer-events-none opacity-40',
          )}
          style={{ top: buddyRailTop, maxHeight: buddyRailMaxHeight }}
        >
          <div className="pointer-events-auto max-h-[inherit] overflow-y-auto overscroll-contain">
            <TherapyBuddyTopRail
              gateHint={wellbeingVoiceGateHint}
              threadId={buddyThreadId}
              thread={buddyActiveThread}
              disabled={reportStream.isStreaming}
              onRequestNewSession={() => void startNewTherapy()}
              onThreadUpdated={(t) => {
                setBuddyActiveThread(t);
                void loadBuddyThreadMeta(t.thread_id);
              }}
              onOpenReport={(r) => {
                setTherapyReport(r);
                setTherapyReportOpen(true);
              }}
              onOpenCheckIn={() => setWellbeingIntakeOpen(true)}
              onTherapyEnded={(r) => setTherapyReport(r)}
            />
          </div>
        </aside>
      ) : null}

      <motion.div className="relative flex min-h-[100dvh] w-full flex-col items-center px-4 pb-16 pt-24 sm:pb-20 sm:pt-28">
        <motion.div className="flex w-full max-w-5xl flex-col items-center">
        <motion.div data-slime-avoid className="relative z-30 mb-2 w-full text-center sm:mb-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-violet-500/80">Slime Chat</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Talk with {getSlimeIdentity(buddySlimeType).displayName}
          </h1>
        </motion.div>
        {showLongThreadBanner ? (
          <BuddyLongThreadBanner
            className="relative z-30 mb-3 w-full max-w-2xl"
            slimeType={buddySlimeType}
            messageCount={buddyMessageCount}
            onStartFresh={() => {
              if (buddySlimeType === 'wellbeing') void startNewTherapy();
              else void startNewBuddyChat();
            }}
            onDismiss={() => {
              const tid = buddyThreadId?.trim();
              if (tid) {
                dismissLongThreadBanner(authUserId, tid);
                setDismissedLongHintFor(tid);
              }
            }}
          />
        ) : null}
        <motion.div
          className={cn(
            'pointer-events-none fixed inset-0 w-full',
            speechOutput?.text ? 'z-[78]' : 'z-[70]',
            buddyIntakeBlockingUi && 'invisible',
          )}
          aria-hidden={buddyIntakeBlockingUi}
        >
          <SlimeCompanionStage
            className="relative h-full w-full"
            profile={slimeDraft}
            slimeType={buddySlimeType}
            advisorState={advisorState}
            speechOutput={speechOutput}
            decisionSuggestion={
              slimeSupportsDecisionMode(buddySlimeType) &&
              !reportOpen &&
              !reportStream.isStreaming &&
              !reportStream.finalTrace
                ? pendingDecision
                : null
            }
            onEvidenceOpen={() => setEvidenceDrawerOpen(true)}
            onDoubleClickToggleCompanion={toggleBuddyCompanion}
            speakAmplitude={speakAmplitude}
          />
        </motion.div>

        {(() => {
          const buddyDockPending: PendingAction | null =
            buddyPendingAction ??
            (buddyDecisionSuggestion
              ? {
                  id: 'buddy-voice-sug',
                  type: (buddyDecisionSuggestion.type || 'decision_report') as PendingAction['type'],
                  title: buddyDecisionSuggestion.title,
                  message: buddyDecisionSuggestion.message,
                  blocks: ['generate_decision_report'],
                  payload: { decision_prompt: pendingDecision?.decision_prompt || '' },
                }
              : null);
          const showBuddyDock =
            slimeSupportsDecisionMode(buddySlimeType) &&
            buddyDockPending &&
            (buddyDockPending.type === 'clarification' ||
              buddyDockPending.type === 'role_mode' ||
              shouldSurfaceDecisionReportPending(buddyDockPending, {
                isReportGenerating: reportStream.isStreaming,
                reportPanelOpen: reportOpen,
                reportComplete: reportStream.status === 'done' && Boolean(reportStream.finalTrace),
              }));
          if (!showBuddyDock) return null;
          return (
            <motion.div
              data-slime-avoid
              className="relative z-[66] mx-auto mt-3 w-full max-w-lg px-1 sm:mt-4"
            >
              <ThreadActionDock
                pendingAction={buddyDockPending}
                disabled={reportStream.isStreaming}
                onClarifySkip={() => void dismissBuddyDecisionSuggestion()}
                onClarifyAnswer={() => {}}
                onGenerateDecisionReport={() =>
                  void startDecisionReportFlow(
                    pendingDecision?.decision_prompt ||
                      decisionPromptFromPendingAction(buddyPendingAction) ||
                      '',
                  )
                }
                onDismissSuggestion={() => void dismissBuddyDecisionSuggestion()}
              />
            </motion.div>
          );
        })()}
        </motion.div>
      </motion.div>

      <DecisionReportStreamingPanel
        open={reportOpen}
        trace={reportStream.trace}
        progressStep={reportStream.progressStep}
        isStreaming={reportStream.isStreaming}
        error={reportStream.error}
        degradedWarnings={reportStream.degradedWarnings}
        scoringClarifyPending={reportStream.scoringClarifyPending}
        gatePrefill={reportStream.gatePrefill}
        onScoringClarifyApply={reportStream.applyScoringClarify}
        onScoringClarifySkip={reportStream.skipScoringClarify}
        onTraceRescored={reportStream.updateTrace}
        onRetryStage={() => {
          void reportStream.retryFromCurrentStage();
        }}
        onClose={() => {
          setReportOpen(false);
        }}
        onContinueChat={() => {
          setReportOpen(false);
        }}
        onOpenExecutionCalendar={(decisionId) => {
          setReportOpen(false);
          navigate(`/execution/${encodeURIComponent(decisionId)}`);
        }}
        onReviseReport={async (decisionId) => {
          const tid = buddyThreadId;
          if (tid) {
            try {
              await apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(tid)}/report-context`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision_id: decisionId, mode: 'revision' }),
              });
            } catch {
              /* optional */
            }
          }
          setReportOpen(false);
          navigate(`/chat?thread=${encodeURIComponent(tid || '')}`);
        }}
      />

      <EvidenceDrawer
        open={evidenceDrawerOpen}
        onClose={() => setEvidenceDrawerOpen(false)}
        items={evidenceDrawerItems}
        flaggedIds={flaggedEvidenceIds}
        onFlagWrong={flagEvidenceWrong}
        onEdit={editEvidenceMemory}
        onDelete={deleteEvidenceMemory}
      />

      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {buddyCornerToast ? (
                <motion.div
                  key={`${buddyCornerToast.tone}:${buddyCornerToast.message}`}
                  role="status"
                  aria-live="polite"
                  initial={{ opacity: 0, y: 12, x: 6 }}
                  animate={{ opacity: 1, y: 0, x: 0 }}
                  exit={{ opacity: 0, y: 8, x: 4 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  style={{
                    bottom: 'max(1.5rem, env(safe-area-inset-bottom, 0px))',
                    right: 'max(1rem, env(safe-area-inset-right, 0px))',
                  }}
                  className={cn(
                    'fixed z-[240] max-w-[min(92vw,320px)] rounded-xl border px-3.5 py-2.5 text-left text-[11px] font-medium leading-snug shadow-lg backdrop-blur-md',
                    buddyCornerToast.tone === 'memory_saved' &&
                      'border-emerald-200/90 bg-emerald-50/96 text-emerald-950 shadow-[0_8px_30px_rgba(16,185,129,0.18)]',
                    buddyCornerToast.tone === 'memory_retrieved' &&
                      'border-violet-200/90 bg-violet-50/96 text-violet-950 shadow-[0_8px_30px_rgba(139,92,246,0.14)]',
                    buddyCornerToast.tone === 'neutral' &&
                      'border-emerald-200/70 bg-white/95 text-emerald-900 shadow-[0_6px_24px_rgba(16,185,129,0.12)]',
                    buddyCornerToast.tone === 'error' &&
                      'border-red-200/90 bg-red-50/96 text-red-950 shadow-[0_8px_30px_rgba(239,68,68,0.12)]',
                  )}
                >
                  {buddyCornerToast.tone === 'memory_saved' && buddyCornerToast.details?.length ? (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Memory updated</p>
                      {buddyCornerToast.details.slice(0, 2).map((d, i) => {
                        const fid = (d.id || '').trim();
                        const action = (d.action || 'saved').trim();
                        const category = (d.category || 'memory').trim();
                        return (
                          <div key={`${fid || i}:${d.text || ''}`} className="rounded-lg border border-emerald-200/80 bg-white/70 px-2 py-1.5">
                            <div className="mb-1 flex items-center gap-1.5">
                              <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                                {action === 'merged' ? 'reinforced' : action}
                              </span>
                              <span className="rounded-full border border-emerald-200 bg-white px-1.5 py-0.5 text-[9px] font-medium text-emerald-800">
                                {category}
                              </span>
                            </div>
                            <p>{String(d.text || '').trim() || buddyCornerToast.message}</p>
                            {fid ? (
                              <div className="mt-1.5 flex gap-2">
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-800 hover:text-emerald-950"
                                  onClick={() => navigate(`/profile?memory=${encodeURIComponent(fid)}`)}
                                >
                                  <Pencil className="h-3 w-3" />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 hover:text-red-900"
                                  onClick={() => void deleteMemoryFromBuddyToast(fid)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    buddyCornerToast.message
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}

      {buddyThreadId ? (
        <RimumuWellbeingIntakeDialog
          open={buddyIntakeBlockingUi}
          threadId={buddyThreadId}
          onClose={() => setWellbeingIntakeOpen(false)}
          onComplete={(memorySaved) => {
            void (async () => {
              await loadBuddyThreadMeta(buddyThreadId);
              await beginBuddyTherapyAfterIntake(buddyThreadId);
              if (memorySaved) {
                scheduleProfileMemoryToast(memorySaved);
              }
            })();
          }}
        />
      ) : null}
      {buddySlimeType === 'wellbeing' ? (
        <RimumuIntroductionDialog open={rimumuIntroOpen} onOpenChange={setRimumuIntroOpen} />
      ) : null}
      <TherapyReportPanel
        open={therapyReportOpen}
        report={therapyReport}
        onClose={() => setTherapyReportOpen(false)}
      />
      <ProfileMemoryToastStack
        toasts={profileMemoryToasts}
        onDismiss={dismissProfileMemoryToast}
        headerTitle={buddySlimeType === 'wellbeing' ? 'Wellbeing memory saved' : 'Profile memory updated'}
        tone={buddySlimeType === 'wellbeing' ? 'rose' : 'emerald'}
      />
    </motion.div>
    </>
  );
}
