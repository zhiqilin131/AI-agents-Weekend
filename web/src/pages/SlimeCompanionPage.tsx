import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Ghost, Home, MessageSquare } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../app/components/ui/tooltip';
import { cn } from '../app/components/ui/utils';
import type { SlimeAdvisorState } from '../app/components/report/SlimeAdvisor';
import { DecisionReportStreamingPanel } from '../app/components/shadow/DecisionReportStreamingPanel';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../app/components/ui/sheet';
import { SlimeCompanionStage } from '../features/slime/SlimeCompanionStage';
import { SlimePersonalizationForm } from '../features/slime/SlimePersonalizationForm';
import type { SlimeDecisionSuggestion } from '../features/slime/SlimeVoiceAgent';
import { SlimeVoiceAgent } from '../features/slime/SlimeVoiceAgent';
import { MemoryEvidenceParticles } from '../app/components/profile/MemoryEvidenceParticles';
import type { MemoryEvidenceItem } from '../app/components/profile/memoryEvidenceTypes';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_SLIME_PROFILE, useSlimeProfile } from '../hooks/useSlimeProfile';
import { useDecisionReportStream } from '../hooks/useDecisionReportStream';
import { apiFetch } from '../utils/apiFetch';
import { primeSpeechSynthesisFromGesture } from '../app/hooks/useSpeechSynthesis';

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
};

export default function SlimeCompanionPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useAuth();
  const authUserId = session?.user?.id ?? null;
  const { slimeProfile, updateSlimeProfile, resetSlimeProfile, refreshSlimeProfile } = useSlimeProfile();
  const [slimeDraft, setSlimeDraft] = useState(DEFAULT_SLIME_PROFILE);
  const [panelOpen, setPanelOpen] = useState(false);
  const [browserVoices, setBrowserVoices] = useState<string[]>([]);
  const [buddyCornerToast, setBuddyCornerToast] = useState<BuddyCornerToast | null>(null);
  const buddyCornerToastTimerRef = useRef<number | null>(null);
  const [advisorState, setAdvisorState] = useState<SlimeAdvisorState>('idle');
  const [memoryParticleItems, setMemoryParticleItems] = useState<MemoryEvidenceItem[]>([]);
  const [memoryParticlesActive, setMemoryParticlesActive] = useState(false);
  const [buddyThreadId, setBuddyThreadId] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<SlimeDecisionSuggestion | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const reportStream = useDecisionReportStream();

  const persistThreadId = useCallback(
    (id: string) => {
      setBuddyThreadId(id);
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

  const flashBuddyCornerToast = useCallback((message: string, tone: BuddyCornerToast['tone']) => {
    if (buddyCornerToastTimerRef.current != null) {
      window.clearTimeout(buddyCornerToastTimerRef.current);
      buddyCornerToastTimerRef.current = null;
    }
    setBuddyCornerToast({ message, tone });
    buddyCornerToastTimerRef.current = window.setTimeout(() => {
      setBuddyCornerToast(null);
      buddyCornerToastTimerRef.current = null;
    }, 3800);
  }, []);

  useEffect(
    () => () => {
      if (buddyCornerToastTimerRef.current != null) {
        window.clearTimeout(buddyCornerToastTimerRef.current);
      }
    },
    [],
  );

  const startDecisionReportFlow = async (prompt: string) => {
    const tid = buddyThreadId;
    if (!tid?.trim()) {
      flashBuddyCornerToast('No chat thread yet — speak once first so I can link the report.', 'error');
      return;
    }
    primeSpeechSynthesisFromGesture();
    const p = prompt.trim() || 'Help me decide.';
    setPendingDecision(null);
    setReportOpen(true);
    const { error } = await reportStream.start({ threadId: tid, decisionPrompt: p });
    if (error && error !== 'cancelled') {
      flashBuddyCornerToast(error.length > 120 ? `${error.slice(0, 120)}…` : error, 'error');
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
    if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') return;
    const sync = () => setBrowserVoices(window.speechSynthesis.getVoices().map((v) => v.name));
    sync();
    window.speechSynthesis.onvoiceschanged = sync;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

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
    <div className="relative min-h-[100dvh] overflow-hidden bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#e8f4ff]">
      <div className="pointer-events-none absolute inset-0 opacity-[0.4] bg-[radial-gradient(ellipse_at_50%_35%,rgba(139,92,246,0.14),transparent_62%)]" />

      <div
        data-slime-avoid
        className="absolute left-3 top-3 z-[60] flex flex-wrap items-center gap-2 sm:left-4 sm:top-4"
      >
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/75 px-4 py-2 text-sm font-medium text-gray-800 shadow-sm backdrop-blur-md transition hover:bg-white"
        >
          <Home className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
          Home
        </button>
        <button
          type="button"
          onClick={() => navigate('/profile')}
          className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/75 px-4 py-2 text-sm font-medium text-gray-800 shadow-sm backdrop-blur-md transition hover:bg-white"
        >
          Profile
        </button>
      </div>

      <button
        type="button"
        data-slime-avoid
        onClick={() => setPanelOpen((open) => !open)}
        className="absolute right-3 top-3 z-[60] inline-flex items-center gap-2 rounded-full border border-violet-200/70 bg-white/80 px-4 py-2 text-sm font-semibold text-violet-950 shadow-sm backdrop-blur-md transition hover:border-violet-400 sm:right-4 sm:top-4"
        aria-expanded={panelOpen}
        aria-label={panelOpen ? 'Close Slime studio' : 'Open Slime studio'}
      >
        <Ghost className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
        {panelOpen ? 'Close' : 'Personalize'}
      </button>

      {/* Bottom-left: link to full Chat UI; logo below — stays clear of center mic column */}
      <div
        data-slime-avoid
        className="absolute bottom-6 left-4 z-[65] flex max-w-[min(280px,calc(100vw-6rem))] flex-col items-start gap-3 sm:bottom-8 sm:left-6"
      >
        <Tooltip delayDuration={250}>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid="slime-buddy-open-chat"
              onClick={() => navigate('/chat')}
              aria-label="Open Chat — traditional full-feature dialog"
              className="inline-flex items-center gap-2 rounded-full border border-violet-200/80 bg-white/85 px-3.5 py-2 text-xs font-semibold text-violet-950 shadow-sm backdrop-blur-md transition hover:border-violet-400/80 hover:bg-white sm:text-sm"
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden />
              Chat
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            sideOffset={10}
            className="max-w-[min(288px,calc(100vw-2rem))] border border-violet-950/20 bg-violet-950 px-3 py-2 text-left text-[11px] leading-relaxed font-medium text-violet-50 shadow-lg"
          >
            Chat 是一个更加传统的对话框，有更加完整的功能。
          </TooltipContent>
        </Tooltip>
        <img
          src="/ForesightXLogo.svg"
          alt=""
          className="pointer-events-none h-8 w-auto max-w-[min(100vw-5rem,240px)] opacity-90 drop-shadow-sm sm:h-9"
          decoding="async"
          aria-hidden
        />
      </div>

      <div className="relative flex min-h-[100dvh] w-full flex-col items-center px-4 pb-16 pt-16 sm:pb-20 sm:pt-20">
        <div className="relative z-40 h-[min(72vh,680px)] w-full max-w-5xl shrink-0">
          {/*
            Voice UI is split z-index inside SlimeVoiceAgent (panels z-32, mic z-52).
            Stage z-44 paints above bubbles/transcript so the buddy stays visible; mic stays on top for taps.
            Memory particles sit between panels and slime (z-38).
          */}
          <SlimeVoiceAgent
            slimeProfile={slimeDraft}
            currentRoute="/buddy"
            threadId={buddyThreadId ?? undefined}
            onThreadId={persistThreadId}
            onDecisionSuggestion={setPendingDecision}
            onAdvisorStateChange={setAdvisorState}
            onMemoryEvidenceBurst={(items) => {
              if (!items.length) return;
              setMemoryParticleItems(items);
              setMemoryParticlesActive(true);
            }}
            onProfileMemorySaved={(msg) => flashBuddyCornerToast(msg, 'memory_saved')}
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
          />
          <div className="pointer-events-none absolute inset-0 z-[38] overflow-visible">
            <MemoryEvidenceParticles
              items={memoryParticleItems}
              active={memoryParticlesActive}
              onDone={() => setMemoryParticlesActive(false)}
            />
          </div>
          <SlimeCompanionStage className="relative z-[44]" profile={slimeDraft} advisorState={advisorState} />
        </div>

        {pendingDecision?.should_show ? (
          <div
            data-slime-avoid
            className="relative z-50 mx-auto mt-8 flex w-[min(100%,400px)] flex-col gap-2 rounded-2xl border border-violet-200/90 bg-white/90 px-4 py-3 text-left shadow-lg backdrop-blur-md sm:mt-10"
          >
            <p className="text-sm font-semibold text-violet-950">{pendingDecision.display_text || 'Activate Decision Mode?'}</p>
            <p className="text-xs leading-relaxed text-gray-700">
              {pendingDecision.description ||
                'I can turn this into a structured decision report with options, trade-offs, risks, and an action plan.'}
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2 text-xs font-semibold text-white shadow-sm"
                onClick={() => void startDecisionReportFlow(pendingDecision.decision_prompt || '')}
              >
                Activate Decision Mode
              </button>
              <button
                type="button"
                className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-800"
                onClick={() => setPendingDecision(null)}
              >
                Keep Chatting
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <DecisionReportStreamingPanel
        open={reportOpen}
        trace={reportStream.trace}
        progressStep={reportStream.progressStep}
        isStreaming={reportStream.isStreaming}
        error={reportStream.error}
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
                    'pointer-events-none fixed z-[240] max-w-[min(92vw,300px)] rounded-xl border px-3.5 py-2.5 text-left text-[11px] font-medium leading-snug shadow-lg backdrop-blur-md',
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
                  {buddyCornerToast.message}
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
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="shrink-0 rounded-full border border-violet-200/80 bg-white/90 px-3 py-1.5 text-xs font-semibold text-violet-950 shadow-sm hover:bg-violet-50"
            >
              Close
            </button>
          </SheetHeader>
          <div className="px-4 pb-8 pt-2">
            <SlimePersonalizationForm
              slimeDraft={slimeDraft}
              setSlimeDraft={setSlimeDraft}
              browserVoices={browserVoices}
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
