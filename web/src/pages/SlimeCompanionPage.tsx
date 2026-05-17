import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Ghost, Home, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { cn } from '../app/components/ui/utils';
import type { SlimeAdvisorState } from '../app/components/report/SlimeAdvisor';
import { ThreadActionDock } from '../app/components/shadow/ThreadActionDock';
import {
  decisionPromptFromPendingAction,
  pendingActionToSuggestion,
  shouldSurfaceDecisionReportPending,
  type PendingAction,
} from '../app/components/shadow/pendingActionTypes';
import { DecisionReportStreamingPanel } from '../app/components/shadow/DecisionReportStreamingPanel';
import type { ShadowSuggestion } from '../app/components/shadow/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../app/components/ui/sheet';
import { BuddyRecentChatPanel } from '../features/slime/BuddyRecentChatPanel';
import { BuddyRecentTherapyPanel } from '../features/slime/BuddyRecentTherapyPanel';
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
import { SlimePersonalizationForm } from '../features/slime/SlimePersonalizationForm';
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
  getSlimeIdentity,
  nextSlimeType,
  normalizeSlimeType,
  slimeSupportsDecisionMode,
  type SlimeType,
} from '../features/slime/slimeIdentity';
import { slimeTypeFromThread } from '../utils/patchThreadSlimeType';

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
  const { slimeProfile, updateSlimeProfile, resetSlimeProfile, refreshSlimeProfile } = useSlimeProfile();
  const [slimeDraft, setSlimeDraft] = useState(DEFAULT_SLIME_PROFILE);
  const [panelOpen, setPanelOpen] = useState(false);
  const [buddyCornerToast, setBuddyCornerToast] = useState<BuddyCornerToast | null>(null);
  const buddyCornerToastTimerRef = useRef<number | null>(null);
  const [advisorState, setAdvisorState] = useState<SlimeAdvisorState>('idle');
  const [speechOutput, setSpeechOutput] = useState<SlimeSpeechOutput | null>(null);
  const [evidenceDrawerItems, setEvidenceDrawerItems] = useState<MemoryEvidenceItem[]>([]);
  const [evidenceDrawerOpen, setEvidenceDrawerOpen] = useState(false);
  const [flaggedEvidenceIds, setFlaggedEvidenceIds] = useState<Set<string>>(() => new Set());
  const [buddyThreadId, setBuddyThreadId] = useState<string | null>(null);
  const [buddyActiveThread, setBuddyActiveThread] = useState<ShadowThread | null>(null);
  const [buddySlimeType, setBuddySlimeType] = useState<SlimeType>(() =>
    readBuddyCompanionPref(authUserId),
  );
  const [wellbeingIntakeOpen, setWellbeingIntakeOpen] = useState(false);
  const [rimumuIntroOpen, setRimumuIntroOpen] = useState(false);
  const [therapyReportOpen, setTherapyReportOpen] = useState(false);
  const [therapyReport, setTherapyReport] = useState<TherapyReport | null>(null);
  const intakePromptThreadRef = useRef<string | null>(null);
  const [buddyRecapRefresh, setBuddyRecapRefresh] = useState(0);
  const [profileMemoryToasts, setProfileMemoryToasts] = useState<ProfileMemoryToast[]>([]);
  const profileMemoryToastTimersRef = useRef<Map<string, number>>(new Map());
  const [pendingDecision, setPendingDecision] = useState<SlimeDecisionSuggestion | null>(null);
  const [buddyPendingAction, setBuddyPendingAction] = useState<PendingAction | null>(null);
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

  const startNewTherapy = useCallback(async () => {
    const res = await apiFetch('/api/shadow-chat/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slime_type: 'wellbeing', title: 'Therapy session' }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { thread?: ShadowThread };
    const tid = data.thread?.thread_id;
    if (!tid) return;
    writeBuddyCompanionPref(authUserId, 'wellbeing');
    setBuddySlimeType('wellbeing');
    persistThreadId(tid, 'wellbeing');
    await loadBuddyThreadMeta(tid, { syncCompanionFromThread: true });
    setWellbeingIntakeOpen(true);
  }, [authUserId, loadBuddyThreadMeta, persistThreadId]);

  const startNewBuddyChat = useCallback(async () => {
    const res = await apiFetch('/api/shadow-chat/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slime_type: 'generalized', title: 'New chat' }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { thread?: ShadowThread };
    const tid = data.thread?.thread_id;
    if (!tid) return;
    writeBuddyCompanionPref(authUserId, 'generalized');
    setBuddySlimeType('generalized');
    persistThreadId(tid, 'generalized');
    await loadBuddyThreadMeta(tid, { syncCompanionFromThread: true });
  }, [authUserId, loadBuddyThreadMeta, persistThreadId]);

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

  /** Keep studio draft in sync with server when the sheet is closed — never stomp unsaved edits while open. */
  useEffect(() => {
    if (panelOpen) return;
    setSlimeDraft(slimeProfile);
  }, [slimeProfile, panelOpen]);

  const wasPanelOpenRef = useRef(false);
  useEffect(() => {
    if (panelOpen && !wasPanelOpenRef.current) {
      setSlimeDraft(slimeProfile);
    }
    wasPanelOpenRef.current = panelOpen;
  }, [panelOpen, slimeProfile]);

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
    setPanelOpen(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

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

  const saveSlime = async () => {
    try {
      const next = await updateSlimeProfile({
        ...slimeDraft,
        ...(slimeDraft.colorTheme !== 'custom' ? { customColors: null } : {}),
      });
      setSlimeDraft(next);
      void refreshSlimeProfile();
      flashBuddyCornerToast('Saved.', 'neutral');
    } catch {
      flashBuddyCornerToast('Could not save — try again.', 'error');
    }
  };

  const resetSlime = async () => {
    try {
      const reset = await resetSlimeProfile();
      setSlimeDraft(reset);
      void refreshSlimeProfile();
      flashBuddyCornerToast('Reset to default.', 'neutral');
    } catch {
      flashBuddyCornerToast('Could not reset.', 'error');
    }
  };

  const buddyIntakeBlockingUi =
    wellbeingIntakeOpen && buddySlimeType === 'wellbeing' && Boolean(buddyThreadId?.trim());

  const buddyFlowModalOpen =
    buddyIntakeBlockingUi || rimumuIntroOpen || therapyReportOpen;

  return (
    <motion.div className="relative min-h-[100dvh] min-w-0 overflow-x-clip bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.9),transparent_25%),linear-gradient(135deg,#fff5fb_0%,#f7f2ff_46%,#e8f4ff_100%)]">
      <div className="pointer-events-none absolute inset-0 opacity-[0.58] bg-[radial-gradient(ellipse_at_50%_38%,rgba(139,92,246,0.18),transparent_58%),radial-gradient(circle_at_18%_72%,rgba(34,211,238,0.12),transparent_30%),radial-gradient(circle_at_82%_70%,rgba(244,114,182,0.10),transparent_32%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/55 to-transparent" />

      <header
        data-slime-avoid
        className="absolute inset-x-0 top-0 z-[62] flex items-start justify-between gap-3 px-3 py-3 sm:px-4 sm:py-4"
      >
        <nav className="flex flex-wrap items-center gap-2">
        <BuddyTooltip content="Go to the Foresight-X home screen and decision workspace.">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/82 px-4 py-2 text-sm font-semibold text-slate-800 shadow-[0_6px_22px_rgba(79,70,229,0.10)] backdrop-blur-md transition hover:bg-white hover:-translate-y-0.5"
          >
            <Home className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
            Home
          </button>
        </BuddyTooltip>
        <BuddyTooltip content="Manage your account, memory sources, and saved traces.">
          <button
            type="button"
            onClick={() => navigate('/profile')}
            className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/82 px-4 py-2 text-sm font-semibold text-slate-800 shadow-[0_6px_22px_rgba(79,70,229,0.10)] backdrop-blur-md transition hover:bg-white hover:-translate-y-0.5"
          >
            Profile
          </button>
        </BuddyTooltip>
        </nav>

        <BuddyTooltip
          side="bottom"
          content={
            panelOpen
              ? 'Close Slime studio. Save from inside the panel if you want to keep changes.'
              : `About ${getSlimeIdentity(buddySlimeType).displayName} — or double-click the slime to switch companion.`
          }
        >
          <button
            type="button"
            onClick={() => setPanelOpen((open) => !open)}
            className="inline-flex items-center gap-2 rounded-full border border-violet-200/70 bg-white/85 px-4 py-2 text-sm font-semibold text-violet-950 shadow-[0_6px_22px_rgba(79,70,229,0.10)] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-violet-400"
            aria-expanded={panelOpen}
            aria-label={panelOpen ? 'Close Slime studio' : 'Open Slime studio'}
          >
            <Ghost className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
            {panelOpen ? 'Close' : 'About'}
          </button>
        </BuddyTooltip>
      </header>

      {buddySlimeType === 'wellbeing' ? (
        <aside
          data-slime-avoid
          className={cn(
            'pointer-events-none fixed z-[48] hidden sm:block',
            'right-[max(0.75rem,env(safe-area-inset-right,0px))]',
            'top-[max(5.75rem,calc(env(safe-area-inset-top,0px)+4.75rem))]',
            'w-[min(17rem,calc(100vw-1.5rem-env(safe-area-inset-right,0px)))]',
            buddyFlowModalOpen && 'pointer-events-none opacity-40',
          )}
          style={{
            maxHeight:
              'calc(100dvh - max(5.75rem, calc(env(safe-area-inset-top, 0px) + 4.75rem)) - env(safe-area-inset-bottom, 0px))',
          }}
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

      {buddySlimeType === 'wellbeing' ? (
        <BuddyRecentTherapyPanel
          className={cn(
            'z-[58]',
            buddyFlowModalOpen && 'z-[40] opacity-40 pointer-events-none',
          )}
          activeThreadId={buddyThreadId}
          storageUserId={authUserId}
          refreshKey={buddyRecapRefresh}
          onSelectThread={(id) => {
            persistThreadId(id, 'wellbeing');
            void loadBuddyThreadMeta(id, { syncCompanionFromThread: true });
          }}
          onStartNewTherapy={() => void startNewTherapy()}
          onOpenFullChat={openBuddyChat}
        />
      ) : (
        <BuddyRecentChatPanel
          activeThreadId={buddyThreadId}
          storageUserId={authUserId}
          refreshKey={buddyRecapRefresh}
          onSelectThread={(id) => {
            persistThreadId(id, 'generalized');
            void loadBuddyThreadMeta(id, { syncCompanionFromThread: true });
          }}
          onStartNewChat={() => void startNewBuddyChat()}
          onOpenFullChat={openBuddyChat}
        />
      )}

      {/* Bottom-left quick actions — below recent panel, clear of mic */}
      <div
        data-slime-avoid
        className={cn(
          'absolute bottom-6 left-4 z-[56] flex flex-col items-stretch gap-2 sm:bottom-8 sm:left-6',
          buddyFlowModalOpen && 'pointer-events-none opacity-40',
        )}
      >
        <motion.div className="flex flex-col gap-2 rounded-2xl border border-white/70 bg-white/75 p-2 shadow-sm backdrop-blur-md">
        <BuddyTooltip content="Opens the full Chat workspace — a classic scrolling thread with richer tools than quick voice here.">
          <button
            type="button"
            data-testid="slime-buddy-open-chat"
            onClick={openBuddyChat}
            aria-label={
              buddyThreadId
                ? 'Open Chat — continue this buddy conversation in the full workspace'
                : 'Open Chat — traditional full-feature dialog'
            }
            className="inline-flex items-center gap-2 rounded-full border border-violet-200/80 bg-white/85 px-3.5 py-2 text-xs font-semibold text-violet-950 shadow-sm backdrop-blur-md transition hover:border-violet-400/80 hover:bg-white sm:text-sm"
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden />
            Chat
          </button>
        </BuddyTooltip>
        {buddySlimeType === 'wellbeing' ? (
          <BuddyTooltip content="How Rimumu works — evidence-informed psychology, session flow, and what she can help with.">
            <RimumuIntroductionTrigger
              className="w-full max-w-none justify-center"
              onClick={() => setRimumuIntroOpen(true)}
            />
          </BuddyTooltip>
        ) : null}
        </motion.div>
      </div>

      <motion.div className="relative flex min-h-[100dvh] w-full flex-col items-center px-4 pb-16 pt-16 sm:pb-20 sm:pt-20">
        <motion.div className="flex w-full max-w-5xl flex-col items-center">
        <div data-slime-avoid className="relative z-30 mb-2 w-full text-center sm:mb-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-violet-500/80">Slime Chat</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Talk with {getSlimeIdentity(buddySlimeType).displayName}
          </h1>
        </div>
        <motion.div
          className={cn(
            'relative h-[min(72vh,680px)] w-full max-w-5xl shrink-0 rounded-[32px]',
            speechOutput?.text ? 'z-[78]' : 'z-[70]',
            buddyIntakeBlockingUi && 'pointer-events-none invisible',
          )}
          aria-hidden={buddyIntakeBlockingUi}
        >
          {/*
            Voice UI is split z-index inside SlimeVoiceAgent (panels z-32, mic z-52).
            Stage z-[70] keeps slime + speech bubble above the right session rail (z-52).
          */}
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
          <SlimeCompanionStage
            className="relative"
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
          />
        </motion.div>
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

      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent
          side="right"
          hideClose
          className="w-full overflow-y-auto border-l border-white/45 bg-white/70 shadow-[0_0_40px_rgba(99,102,241,0.12)] backdrop-blur-2xl sm:max-w-md"
        >
          <SheetHeader className="flex flex-row items-center justify-between gap-3 border-b border-white/50 pb-3 pt-1">
            <SheetTitle className="text-left text-violet-950">
              {getSlimeIdentity(buddySlimeType).displayName}
            </SheetTitle>
            <BuddyTooltip content="Close Slime studio. Use Save slime inside the panel to persist changes.">
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="shrink-0 rounded-full border border-violet-200/80 bg-white/90 px-3 py-1.5 text-xs font-semibold text-violet-950 shadow-sm hover:bg-violet-50"
              >
                Close
              </button>
            </BuddyTooltip>
          </SheetHeader>
          <div className="px-4 pb-8 pt-2">
            <SlimePersonalizationForm
              slimeType={buddySlimeType}
              onSlimeTypeChange={applyBuddyCompanionSwitch}
            />
          </div>
        </SheetContent>
      </Sheet>

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
  );
}
