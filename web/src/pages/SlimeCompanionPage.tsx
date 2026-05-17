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

/** Legacy single-key storage; per-user keys are ``${prefix}:${supabaseUserId}``. */
const BUDDY_THREAD_STORAGE_PREFIX = 'slimeBuddyShadowThreadId';

function buddyThreadStorageKey(userId: string | null | undefined): string | null {
  const u = userId?.trim();
  if (!u) return null;
  return `${BUDDY_THREAD_STORAGE_PREFIX}:${u}`;
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
  const [buddyRecapRefresh, setBuddyRecapRefresh] = useState(0);
  const [pendingDecision, setPendingDecision] = useState<SlimeDecisionSuggestion | null>(null);
  const [buddyPendingAction, setBuddyPendingAction] = useState<PendingAction | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [decisionModeManual, setDecisionModeManual] = useState(false);
  const reportStream = useDecisionReportStream();

  const persistThreadId = useCallback(
    (id: string) => {
      setBuddyThreadId(id);
      setBuddyRecapRefresh((n) => n + 1);
      const k = buddyThreadStorageKey(authUserId);
      if (!k) return;
      try {
        localStorage.setItem(k, id);
        localStorage.removeItem(BUDDY_THREAD_STORAGE_PREFIX);
      } catch {
        /* ignore */
      }
    },
    [authUserId],
  );

  const openBuddyChat = useCallback(() => {
    const tid = buddyThreadId?.trim();
    if (tid) {
      navigate(`/chat?thread=${encodeURIComponent(tid)}`);
      return;
    }
    navigate('/chat');
  }, [buddyThreadId, navigate]);

  const onBuddyConversationUpdated = useCallback(() => {
    setBuddyRecapRefresh((n) => n + 1);
  }, []);

  useEffect(() => {
    const k = buddyThreadStorageKey(authUserId);
    if (!k) {
      setBuddyThreadId(null);
      return;
    }
    try {
      setBuddyThreadId(localStorage.getItem(k));
    } catch {
      setBuddyThreadId(null);
    }
  }, [authUserId]);

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

  const buddyDecisionSuggestion: ShadowSuggestion | null =
    pendingActionToSuggestion(buddyPendingAction) ??
    (pendingDecision?.should_show
      ? {
          type: 'decision_report',
          title: pendingDecision.display_text?.trim() || 'Turn this into a decision report?',
          message:
            pendingDecision.description?.trim() ||
            'I can structure this into options, trade-offs, risks, consequences, and an action plan.',
        }
      : null);

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

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.9),transparent_25%),linear-gradient(135deg,#fff5fb_0%,#f7f2ff_46%,#e8f4ff_100%)]">
      <div className="pointer-events-none absolute inset-0 opacity-[0.58] bg-[radial-gradient(ellipse_at_50%_38%,rgba(139,92,246,0.18),transparent_58%),radial-gradient(circle_at_18%_72%,rgba(34,211,238,0.12),transparent_30%),radial-gradient(circle_at_82%_70%,rgba(244,114,182,0.10),transparent_32%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/55 to-transparent" />

      <div
        data-slime-avoid
        className="absolute left-3 top-3 z-[60] flex flex-wrap items-center gap-2 sm:left-4 sm:top-4"
      >
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
      </div>

      <BuddyTooltip
        side="bottom"
        content={
          panelOpen
            ? 'Close Slime studio. Save from inside the panel if you want to keep changes.'
            : 'Open Slime studio to edit colors, voice, persona, and how your buddy talks.'
        }
      >
        <button
          type="button"
          data-slime-avoid
          onClick={() => setPanelOpen((open) => !open)}
          className="absolute right-3 top-3 z-[60] inline-flex items-center gap-2 rounded-full border border-violet-200/70 bg-white/85 px-4 py-2 text-sm font-semibold text-violet-950 shadow-[0_6px_22px_rgba(79,70,229,0.10)] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-violet-400 sm:right-4 sm:top-4"
          aria-expanded={panelOpen}
          aria-label={panelOpen ? 'Close Slime studio' : 'Open Slime studio'}
        >
          <Ghost className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
          {panelOpen ? 'Close' : 'Personalize'}
        </button>
      </BuddyTooltip>

      <BuddyRecentChatPanel
        threadId={buddyThreadId}
        refreshToken={buddyRecapRefresh}
        slimeName={slimeDraft.name}
        storageUserId={authUserId}
        onOpenFullChat={openBuddyChat}
      />

      {/* Bottom-left: link to full Chat UI; logo below — stays clear of center mic column */}
      <div
        data-slime-avoid
        className="absolute bottom-6 left-4 z-[65] flex max-w-[min(280px,calc(100vw-6rem))] flex-col items-start gap-3 sm:bottom-8 sm:left-6"
      >
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
        <img
          src="/ForesightXLogo.svg"
          alt=""
          className="pointer-events-none h-8 w-auto max-w-[min(100vw-5rem,240px)] opacity-90 drop-shadow-sm sm:h-9"
          decoding="async"
          aria-hidden
        />
      </div>

      <div className="relative flex min-h-[100dvh] w-full flex-col items-center px-4 pb-16 pt-16 sm:pb-20 sm:pt-20">
        <div data-slime-avoid className="relative z-30 mb-2 text-center sm:mb-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-violet-500/80">Slime Chat</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Talk with {slimeDraft.name?.trim() || 'your Slime'}
          </h1>
        </div>
        <div className="relative z-40 h-[min(72vh,680px)] w-full max-w-5xl shrink-0 rounded-[32px]">
          {/*
            Voice UI is split z-index inside SlimeVoiceAgent (panels z-32, mic z-52).
            Stage z-44 paints above bubbles/transcript so the buddy stays visible; mic stays on top for taps.
          */}
          <SlimeVoiceAgent
            slimeProfile={slimeDraft}
            currentRoute="/buddy"
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
            onProfileMemorySaved={(payload) =>
              flashBuddyCornerToast(payload.message, 'memory_saved', payload.details || [])
            }
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
            decisionModeActive={decisionModeManual}
            onToggleDecisionMode={() => setDecisionModeManual((v) => !v)}
            decisionModeToggleDisabled={reportStream.isStreaming}
          />
          <SlimeCompanionStage
            className="relative z-[44]"
            profile={slimeDraft}
            advisorState={advisorState}
            speechOutput={speechOutput}
            decisionSuggestion={
              reportOpen || reportStream.isStreaming || reportStream.finalTrace ? null : pendingDecision
            }
            onEvidenceOpen={() => setEvidenceDrawerOpen(true)}
          />
        </div>

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
              className="relative z-[48] mx-auto mt-3 w-full max-w-lg px-1 sm:mt-4"
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
            <SheetTitle className="text-left text-violet-950">Slime studio</SheetTitle>
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
              slimeDraft={slimeDraft}
              setSlimeDraft={setSlimeDraft}
              onSave={async () => {
                await saveSlime();
              }}
              onReset={async () => {
                await resetSlime();
              }}
              idPrefix="buddy"
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
