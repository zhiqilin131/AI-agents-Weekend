import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Ghost, Home } from 'lucide-react';
import type { SlimeAdvisorState } from '../app/components/report/SlimeAdvisor';
import { DecisionReportStreamingPanel } from '../app/components/shadow/DecisionReportStreamingPanel';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../app/components/ui/sheet';
import { SlimeCompanionStage } from '../features/slime/SlimeCompanionStage';
import { SlimePersonalizationForm } from '../features/slime/SlimePersonalizationForm';
import type { SlimeDecisionSuggestion } from '../features/slime/SlimeVoiceAgent';
import { SlimeVoiceAgent } from '../features/slime/SlimeVoiceAgent';
import { MemoryEvidenceParticles } from '../app/components/profile/MemoryEvidenceParticles';
import type { MemoryEvidenceItem } from '../app/components/profile/memoryEvidenceTypes';
import { DEFAULT_SLIME_PROFILE, useSlimeProfile } from '../hooks/useSlimeProfile';
import { useDecisionReportStream } from '../hooks/useDecisionReportStream';
import { apiUrl } from '../utils/apiOrigin';
import { primeSpeechSynthesisFromGesture } from '../app/hooks/useSpeechSynthesis';

const BUDDY_THREAD_STORAGE_KEY = 'slimeBuddyShadowThreadId';

export default function SlimeCompanionPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { slimeProfile, updateSlimeProfile, resetSlimeProfile } = useSlimeProfile();
  const [slimeDraft, setSlimeDraft] = useState(DEFAULT_SLIME_PROFILE);
  const [panelOpen, setPanelOpen] = useState(false);
  const [browserVoices, setBrowserVoices] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [memorySavedToast, setMemorySavedToast] = useState<string | null>(null);
  const memorySavedToastTimerRef = useRef<number | null>(null);
  const [advisorState, setAdvisorState] = useState<SlimeAdvisorState>('idle');
  const [memoryParticleItems, setMemoryParticleItems] = useState<MemoryEvidenceItem[]>([]);
  const [memoryParticlesActive, setMemoryParticlesActive] = useState(false);
  const [buddyThreadId, setBuddyThreadId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(BUDDY_THREAD_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [pendingDecision, setPendingDecision] = useState<SlimeDecisionSuggestion | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const reportStream = useDecisionReportStream();

  const persistThreadId = useCallback((id: string) => {
    setBuddyThreadId(id);
    try {
      localStorage.setItem(BUDDY_THREAD_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const flashMemorySavedToast = useCallback((message: string) => {
    if (memorySavedToastTimerRef.current != null) {
      window.clearTimeout(memorySavedToastTimerRef.current);
      memorySavedToastTimerRef.current = null;
    }
    setMemorySavedToast(message);
    memorySavedToastTimerRef.current = window.setTimeout(() => {
      setMemorySavedToast(null);
      memorySavedToastTimerRef.current = null;
    }, 3800);
  }, []);

  useEffect(
    () => () => {
      if (memorySavedToastTimerRef.current != null) {
        window.clearTimeout(memorySavedToastTimerRef.current);
      }
    },
    [],
  );

  const startDecisionReportFlow = async (prompt: string) => {
    const tid = buddyThreadId;
    if (!tid?.trim()) {
      setToast('No chat thread yet — speak once first so I can link the report.');
      return;
    }
    primeSpeechSynthesisFromGesture();
    const p = prompt.trim() || 'Help me decide.';
    setPendingDecision(null);
    setReportOpen(true);
    const { error } = await reportStream.start({ threadId: tid, decisionPrompt: p });
    if (error && error !== 'cancelled') {
      setToast(error.length > 120 ? `${error.slice(0, 120)}…` : error);
    }
  };

  useEffect(() => {
    setSlimeDraft(slimeProfile);
  }, [slimeProfile]);

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
    setToast(null);
    try {
      const next = await updateSlimeProfile({
        ...slimeDraft,
        ...(slimeDraft.colorTheme !== 'custom' ? { customColors: null } : {}),
      });
      setSlimeDraft(next);
      setToast('Saved.');
    } catch {
      setToast('Could not save — try again.');
    }
  };

  const resetSlime = async () => {
    setToast(null);
    try {
      const reset = await resetSlimeProfile();
      setSlimeDraft(reset);
      setToast('Reset to default.');
    } catch {
      setToast('Could not reset.');
    }
  };

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#e8f4ff]">
      <div className="pointer-events-none absolute inset-0 opacity-[0.4] bg-[radial-gradient(ellipse_at_50%_35%,rgba(139,92,246,0.14),transparent_62%)]" />

      <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2 sm:left-4 sm:top-4">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/75 px-3 py-1.5 text-xs font-medium text-gray-800 shadow-sm backdrop-blur-md transition hover:bg-white"
        >
          <Home className="h-3.5 w-3.5 text-violet-600" aria-hidden />
          Home
        </button>
        <button
          type="button"
          onClick={() => navigate('/profile')}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/75 px-3 py-1.5 text-xs font-medium text-gray-800 shadow-sm backdrop-blur-md transition hover:bg-white"
        >
          Profile
        </button>
      </div>

      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        className="absolute right-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full border border-violet-200/70 bg-white/80 px-3 py-1.5 text-xs font-semibold text-violet-950 shadow-sm backdrop-blur-md transition hover:border-violet-400 sm:right-4 sm:top-4"
        aria-label="Personalize your Slime"
      >
        <Ghost className="h-3.5 w-3.5 text-violet-600" aria-hidden />
        Personalize
      </button>

      <div
        className="pointer-events-none absolute bottom-6 left-6 z-20 sm:bottom-8 sm:left-8"
        aria-hidden
      >
        <img
          src="/ForesightXLogo.svg"
          alt=""
          className="h-9 w-auto max-w-[min(100vw-3rem,280px)] opacity-95 drop-shadow-sm sm:h-10"
          decoding="async"
        />
      </div>

      <div className="relative z-10 flex min-h-[100dvh] w-full flex-col items-center px-4 pb-28 pt-20">
        <div className="relative h-[min(72vh,680px)] w-full max-w-5xl shrink-0">
          <SlimeCompanionStage profile={slimeDraft} advisorState={advisorState} />
          <div className="pointer-events-none absolute inset-0 z-[22] overflow-visible">
            <MemoryEvidenceParticles
              items={memoryParticleItems}
              active={memoryParticlesActive}
              onDone={() => setMemoryParticlesActive(false)}
            />
          </div>
          <SlimeVoiceAgent
            className="absolute bottom-2 left-1/2 w-[min(100%,380px)] -translate-x-1/2"
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
            onProfileMemorySaved={flashMemorySavedToast}
            onUpdateSlimeProfile={async (patch) => {
              const next = await updateSlimeProfile(patch);
              setSlimeDraft(next);
            }}
          />
        </div>

        {pendingDecision?.should_show ? (
          <div className="relative z-20 mx-auto mt-4 flex w-[min(100%,400px)] flex-col gap-2 rounded-2xl border border-violet-200/90 bg-white/90 px-4 py-3 text-left shadow-lg backdrop-blur-md">
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

        <motion.button
          type="button"
          className="mt-8 max-w-md cursor-pointer text-center"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          onClick={() => setPanelOpen(true)}
        >
          <span className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-600 bg-clip-text text-sm font-semibold tracking-wide text-transparent">
            Tap the slime to wiggle · text opens personalize
          </span>
        </motion.button>
        {toast ? <p className="mt-6 text-center text-xs text-emerald-700">{toast}</p> : null}
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
              await fetch(apiUrl(`/api/shadow-chat/threads/${encodeURIComponent(tid)}/report-context`), {
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

      <AnimatePresence>
        {memorySavedToast ? (
          <motion.div
            key={memorySavedToast}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="pointer-events-none fixed bottom-6 right-4 z-[200] max-w-[min(92vw,300px)] rounded-xl border border-emerald-200/90 bg-emerald-50/96 px-3.5 py-2.5 text-right shadow-[0_8px_30px_rgba(16,185,129,0.18)] backdrop-blur-md sm:bottom-8 sm:right-6"
          >
            <p className="text-[11px] font-medium leading-snug text-emerald-950">{memorySavedToast}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto border-l border-white/45 bg-white/70 shadow-[0_0_40px_rgba(99,102,241,0.12)] backdrop-blur-2xl sm:max-w-md"
        >
          <SheetHeader className="border-b border-white/50 pb-3">
            <SheetTitle className="text-violet-950">Slime studio</SheetTitle>
            <SheetDescription className="text-gray-600">
              Same profile as reports and Shadow. Save syncs to your account slime.
            </SheetDescription>
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
