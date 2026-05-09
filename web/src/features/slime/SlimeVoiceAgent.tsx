import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceRecorderSpeechPhase } from '../../hooks/useVoiceRecorder';
import { Mic, Square } from 'lucide-react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import type { SlimeAdvisorState } from '../../app/components/report/SlimeAdvisor';
import { EvidenceDrawer } from '../../app/components/profile/EvidenceDrawer';
import type { MemoryEvidenceItem } from '../../app/components/profile/memoryEvidenceTypes';
import { primeSpeechSynthesisFromGesture, useSpeechSynthesis } from '../../app/hooks/useSpeechSynthesis';
import { playMp3BlobWithWebAudio, unlockSlimeAudioContext } from '../../utils/slimeAudioContext';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import type { SlimeProfile } from '../../app/model';
import { apiFetchErrorMessage, apiUrl } from '../../utils/apiOrigin';
import { confirmCalendarDraft } from '../../utils/calendarAgentApi';
import { EXECUTION_EVENTS_STORAGE_KEY, SLIME_VOICE_CALENDAR_RESOLVED_KEY } from '../../utils/executionStorageKeys';
import {
  applySlimeVoiceFrontendAction,
  normalizeVoiceSlimePatch,
  type SlimeVoiceFrontendAction,
} from '../../utils/slimeVoiceActions';
import { cn } from '../../app/components/ui/utils';

export type VoiceAgentState =
  | 'idle'
  | 'listening'
  | 'hearing_speech'
  | 'auto_stopping'
  | 'transcribing'
  | 'searching_memory'
  | 'synthesizing'
  | 'thinking'
  | 'speaking'
  | 'executing_tool'
  | 'awaiting_confirmation'
  | 'decision_prompt'
  | 'error';

export type SlimeDecisionSuggestion = {
  should_show?: boolean;
  decision_prompt?: string;
  display_text?: string;
  spoken_prompt?: string;
  description?: string;
};

export type SlimeVoiceAgentProps = {
  slimeProfile: SlimeProfile;
  onUpdateSlimeProfile?: (patch: Partial<SlimeProfile>) => Promise<void> | void;
  onAdvisorStateChange?: (s: SlimeAdvisorState) => void;
  onMemoryEvidenceBurst?: (items: MemoryEvidenceItem[]) => void;
  /** Shadow chat thread id (persist across Buddy sessions). */
  threadId?: string;
  onThreadId?: (id: string) => void;
  onDecisionSuggestion?: (s: SlimeDecisionSuggestion | null) => void;
  /** Buddy page: corner toast when profile-memory facts were saved. */
  onProfileMemorySaved?: (message: string) => void;
  /** Buddy page: corner toast when a memory search returned evidence snippets. */
  onMemoryEvidenceRetrieved?: (count: number) => void;
  currentRoute?: string;
  className?: string;
};

type ResolvedCalendar = {
  title: string;
  start_iso: string;
  end_iso: string;
  display_summary: string;
  duration_minutes?: number;
  ambiguity_note?: string | null;
  timezone?: string;
};

function mapVoiceToAdvisor(v: VoiceAgentState): SlimeAdvisorState {
  switch (v) {
    case 'listening':
      return 'listening';
    case 'hearing_speech':
    case 'auto_stopping':
    case 'decision_prompt':
      return 'thinking';
    case 'transcribing':
    case 'thinking':
    case 'executing_tool':
    case 'searching_memory':
    case 'synthesizing':
    case 'awaiting_confirmation':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    case 'error':
      return 'cautious';
    default:
      return 'idle';
  }
}

function statusLabel(s: VoiceAgentState): string {
  switch (s) {
    case 'listening':
      return 'Listening…';
    case 'hearing_speech':
      return 'I hear you…';
    case 'auto_stopping':
      return 'Got it.';
    case 'transcribing':
      return 'Transcribing…';
    case 'searching_memory':
      return 'Searching memory…';
    case 'synthesizing':
      return 'Putting the memories together…';
    case 'thinking':
      return 'Thinking…';
    case 'executing_tool':
      return 'Working on it…';
    case 'speaking':
      return 'Speaking…';
    case 'awaiting_confirmation':
      return 'Waiting for your confirmation…';
    case 'decision_prompt':
      return 'Decision Mode available';
    case 'error':
      return 'Something went wrong';
    default:
      return '';
  }
}

type VoiceResponse = {
  transcript?: string;
  asr_provider?: string;
  assistant_text?: string;
  /** Persona-aware line for TTS (falls back to assistant_text if omitted). */
  spoken_text?: string;
  spoken_sequence?: string[];
  thread_id?: string;
  decision_suggestion?: SlimeDecisionSuggestion | null;
  memory_updates?: string[];
  tool_call?: { name?: string };
  frontend_action?: SlimeVoiceFrontendAction;
  tool_result?: { evidence_items?: MemoryEvidenceItem[]; conversation_turn?: boolean };
  voice_ui?: {
    intent?: string;
    memory_phases?: string[];
    evidence_items?: MemoryEvidenceItem[];
    should_show_evidence_drawer?: boolean;
  };
  timing?: { asr_model_load_ms?: number | null; total_ms?: number };
};

function httpErrorBodyToMessage(body: string, fallback: string): string {
  const t = body.trim();
  if (!t.startsWith('{')) return t || fallback;
  try {
    const j = JSON.parse(t) as { detail?: unknown };
    const d = j.detail;
    if (typeof d === 'string') return d;
    return t || fallback;
  } catch {
    return t || fallback;
  }
}

function friendlySlimeVoiceError(msg: string): string {
  const m = msg.trim().toLowerCase();
  if (m.includes('no_speech_detected')) {
    return 'No speech detected in that take — hold the mic a little longer or speak closer, then try again.';
  }
  return msg;
}

function formatProfileMemoryToast(memoryUpdates: string[]): string {
  const cleaned = memoryUpdates.map((s) => s.trim()).filter(Boolean);
  if (!cleaned.length) return '';
  const ellipsize = (s: string, max: number) => {
    const t = s.replace(/\s+/g, ' ');
    if (t.length <= max) return t;
    return `${t.slice(0, max - 1)}…`;
  };
  if (cleaned.length === 1) return `${ellipsize(cleaned[0], 52)} saved in memory`;
  return `${cleaned.length} notes saved in memory`;
}

function readEvidenceItems(data: VoiceResponse): MemoryEvidenceItem[] {
  const a = data.voice_ui?.evidence_items;
  const b = data.tool_result?.evidence_items;
  const raw = (Array.isArray(a) && a.length ? a : b) ?? [];
  return raw.filter((x) => x && typeof x.id === 'string') as MemoryEvidenceItem[];
}

function speechPhaseLabel(phase: VoiceRecorderSpeechPhase, recording: boolean): string | null {
  if (!recording) return null;
  if (phase === 'waiting_speech') return 'Listening…';
  if (phase === 'hearing_speech') return 'I hear you…';
  if (phase === 'trailing_silence') return 'Got it.';
  return null;
}

export function SlimeVoiceAgent({
  slimeProfile,
  onUpdateSlimeProfile,
  onAdvisorStateChange,
  onMemoryEvidenceBurst,
  threadId,
  onThreadId,
  onDecisionSuggestion,
  onProfileMemorySaved,
  onMemoryEvidenceRetrieved,
  currentRoute,
  className,
}: SlimeVoiceAgentProps) {
  const navigate = useNavigate();
  const sendVoiceBlobRef = useRef<(blob: Blob | null) => Promise<void>>(async () => {});
  const { supported, recording, error, setError, startRecording, stopRecording, speechPhase } = useVoiceRecorder({
    autoStopOnSilence: true,
    silenceDetectionConfig: {
      silenceThreshold: 0.018,
      silenceDurationMs: 1200,
      minSpeechMs: 320,
      maxRecordingMs: 30000,
      maxInitialSilenceMs: 8000,
    },
    onAutoStop: (blob) => {
      void sendVoiceBlobRef.current(blob);
    },
  });
  const { supported: ttsSupported, speak, cancel: cancelTts, isSpeaking } = useSpeechSynthesis();

  const [voiceState, setVoiceState] = useState<VoiceAgentState>('idle');
  const [transcriptPreview, setTranscriptPreview] = useState<string | null>(null);
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const [ttsHint, setTtsHint] = useState<string | null>(null);
  const [buddyAudioPlaying, setBuddyAudioPlaying] = useState(false);
  const buddyAudioRef = useRef<HTMLAudioElement | null>(null);
  const buddyWebAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const buddyObjectUrlRef = useRef<string | null>(null);
  /** True while /api/slime/tts fetch or blob decode is in flight (buddyAudioRef not set yet). */
  const buddyTtsLoadPendingRef = useRef(false);
  /** Bumps when a new TTS request or recording session invalidates in-flight playback. */
  const ttsGenRef = useRef(0);
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    patch: Record<string, unknown>;
  } | null>(null);
  const [pendingCalendar, setPendingCalendar] = useState<ResolvedCalendar | null>(null);
  const [pendingAgentDraftId, setPendingAgentDraftId] = useState<string | null>(null);
  const [drawerItems, setDrawerItems] = useState<MemoryEvidenceItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showEvidenceCta, setShowEvidenceCta] = useState(false);

  useEffect(() => {
    onAdvisorStateChange?.(mapVoiceToAdvisor(voiceState));
  }, [voiceState, onAdvisorStateChange]);

  const cancelBuddyAudio = useCallback(() => {
    const w = buddyWebAudioSourceRef.current;
    buddyWebAudioSourceRef.current = null;
    if (w) {
      try {
        w.stop();
      } catch {
        /* already ended */
      }
    }
    const a = buddyAudioRef.current;
    buddyAudioRef.current = null;
    const u = buddyObjectUrlRef.current;
    buddyObjectUrlRef.current = null;
    buddyTtsLoadPendingRef.current = false;
    if (a) {
      a.onended = null;
      a.onerror = null;
      a.pause();
      a.removeAttribute('src');
    }
    if (u) URL.revokeObjectURL(u);
    setBuddyAudioPlaying(false);
  }, []);

  useEffect(() => () => cancelBuddyAudio(), [cancelBuddyAudio]);

  const runTts = useCallback(
    (
      text: string,
      opts?: {
        /**
         * Bypass `voice.enabled === false` (Personalize “Voice output: Off”) so playback still runs.
         * Use for “Play reply” taps and for replies right after a voice-command / mic flow.
         */
        force?: boolean;
        onMayHaveBlocked?: () => void;
        onComplete?: () => void;
      },
    ) => {
      const voiceOff = slimeProfile.voice?.enabled === false;
      const useTts = ttsSupported && Boolean(text?.trim()) && (opts?.force === true || !voiceOff);
      if (!useTts) {
        setVoiceState('idle');
        opts?.onComplete?.();
        return;
      }

      cancelTts();
      cancelBuddyAudio();
      const gen = ++ttsGenRef.current;
      setVoiceState('speaking');
      buddyTtsLoadPendingRef.current = true;
      const onComplete = opts?.onComplete;

      const synthOpts = {
        rate: slimeProfile.voice?.rate,
        pitch: slimeProfile.voice?.pitch,
        preferredVoiceName: slimeProfile.voice?.preferredVoiceName,
        onMayHaveBlocked: opts?.onMayHaveBlocked,
        onUtteranceEnd: () => {
          if (gen === ttsGenRef.current) setVoiceState('idle');
          onComplete?.();
        },
      };

      void (async () => {
        try {
          const r = await fetch(apiUrl('/api/slime/tts'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
          if (gen !== ttsGenRef.current) return;
          if (r.ok) {
            const blob = await r.blob();
            if (gen !== ttsGenRef.current) return;
            buddyTtsLoadPendingRef.current = false;
            setBuddyAudioPlaying(true);
            const finishOutput = () => {
              cancelBuddyAudio();
              if (gen === ttsGenRef.current) setVoiceState('idle');
              onComplete?.();
            };
            const webOk = await playMp3BlobWithWebAudio(blob, {
              onEnded: finishOutput,
              trackSource: (node) => {
                buddyWebAudioSourceRef.current = node;
              },
            });
            if (gen !== ttsGenRef.current) return;
            if (webOk) return;

            const url = URL.createObjectURL(blob);
            buddyObjectUrlRef.current = url;
            const audio = new Audio();
            buddyAudioRef.current = audio;
            audio.playsInline = true;
            audio.setAttribute('playsinline', 'true');
            audio.preload = 'auto';
            audio.src = url;
            audio.onended = finishOutput;
            audio.onerror = () => {
              cancelBuddyAudio();
              setVoiceState('idle');
              setTtsHint('Could not play audio — check API / OPENAI_API_KEY, or try again.');
              onComplete?.();
            };
            try {
              await audio.play();
            } catch {
              cancelBuddyAudio();
              if (gen !== ttsGenRef.current) return;
              speak(text, synthOpts);
            }
            return;
          }
          if (r.status === 503) {
            setTtsHint('Voice needs OPENAI_API_KEY on the API (same as chat). Falling back to browser speech…');
          }
        } catch {
          /* fall through */
        }
        buddyTtsLoadPendingRef.current = false;
        if (gen !== ttsGenRef.current) return;
        speak(text, synthOpts);
      })();
    },
    [ttsSupported, slimeProfile.voice, speak, cancelTts, cancelBuddyAudio],
  );

  const runSpokenSequence = useCallback(
    (parts: string[], baseOpts?: { force?: boolean; onAllComplete?: () => void }) => {
      const lines = parts.map((p) => p.trim()).filter(Boolean);
      if (!lines.length) {
        baseOpts?.onAllComplete?.();
        return;
      }
      const playAt = (index: number) => {
        if (index >= lines.length) return;
        const isLast = index + 1 >= lines.length;
        runTts(lines[index], {
          force: baseOpts?.force ?? true,
          onComplete: isLast ? baseOpts?.onAllComplete : () => playAt(index + 1),
        });
      };
      playAt(0);
    },
    [runTts],
  );

  const mergeCalendarEvent = useCallback((event: Record<string, unknown>) => {
    try {
      const raw = localStorage.getItem(EXECUTION_EVENTS_STORAGE_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
      if (!Array.isArray(arr)) return;
      arr.push(event);
      localStorage.setItem(EXECUTION_EVENTS_STORAGE_KEY, JSON.stringify(arr));
    } catch {
      /* ignore */
    }
  }, []);

  const onConfirmCalendar = useCallback(async () => {
    primeSpeechSynthesisFromGesture();
    try {
      if (pendingAgentDraftId) {
        const events = await confirmCalendarDraft(pendingAgentDraftId);
        for (const ev of events) {
          mergeCalendarEvent(ev);
        }
        setPendingAgentDraftId(null);
        setPendingCalendar(null);
        setBubbleText('Done — I added it to your execution calendar.');
        runTts('Done — I added it to your execution calendar.', {
          force: true,
          onMayHaveBlocked: () =>
            setTtsHint('No audio? Tap “Play reply” below after the message appears.'),
        });
        return;
      }
      if (!pendingCalendar) return;
      const res = await fetch(apiUrl('/api/slime/confirm-calendar-block'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: pendingCalendar.title,
          start: pendingCalendar.start_iso,
          end: pendingCalendar.end_iso,
          description: pendingCalendar.ambiguity_note || null,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(httpErrorBodyToMessage(t, res.statusText));
      }
      const body = (await res.json()) as { event?: Record<string, unknown> };
      if (body.event) mergeCalendarEvent(body.event);
      setPendingCalendar(null);
      setBubbleText('Done — I added it to your execution calendar.');
      runTts('Done — I added it to your execution calendar.', {
        force: true,
        onMayHaveBlocked: () =>
          setTtsHint('No audio? Tap “Play reply” below after the message appears.'),
      });
    } catch (e) {
      setBubbleText(apiFetchErrorMessage(e));
      setVoiceState('error');
    }
  }, [pendingAgentDraftId, pendingCalendar, mergeCalendarEvent, runTts]);

  const onEditCalendar = useCallback(() => {
    if (!pendingCalendar) return;
    try {
      sessionStorage.setItem(SLIME_VOICE_CALENDAR_RESOLVED_KEY, JSON.stringify(pendingCalendar));
    } catch {
      /* ignore */
    }
    setPendingAgentDraftId(null);
    setPendingCalendar(null);
    navigate('/execution');
  }, [pendingCalendar, navigate]);

  const sendVoiceBlob = useCallback(
    async (blob: Blob | null) => {
      unlockSlimeAudioContext();
      primeSpeechSynthesisFromGesture();
      setVoiceState('transcribing');
      if (!blob) {
        setVoiceState('idle');
        setBubbleText('No audio captured.');
        return;
      }
      const fd = new FormData();
      fd.append('audio', blob, 'voice.webm');
      if (currentRoute) fd.append('current_route', currentRoute);
      if (threadId) fd.append('thread_id', threadId);
      fd.append('slime_profile', JSON.stringify(slimeProfile));
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        fd.append('recent_ui_context', JSON.stringify({ timezone: tz }));
      } catch {
        fd.append('recent_ui_context', JSON.stringify({}));
      }
      setVoiceState('thinking');
      try {
        const res = await fetch(apiUrl('/api/slime/voice-command'), { method: 'POST', body: fd });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(httpErrorBodyToMessage(t, res.statusText));
        }
        const data = (await res.json()) as VoiceResponse;
        if (data.thread_id) onThreadId?.(data.thread_id);
        const mus = data.memory_updates;
        if (mus?.length) {
          const toastMsg = formatProfileMemoryToast(mus);
          if (toastMsg) onProfileMemorySaved?.(toastMsg);
        }

        const phases = data.voice_ui?.memory_phases ?? [];
        if (phases.includes('searching_memory')) {
          setVoiceState('searching_memory');
          await new Promise((r) => setTimeout(r, 400));
        }
        if (phases.includes('synthesizing')) {
          setVoiceState('synthesizing');
          await new Promise((r) => setTimeout(r, 420));
        }

        const evidenceItems = readEvidenceItems(data);
        setDrawerItems(evidenceItems);
        setShowEvidenceCta(
          Boolean(evidenceItems.length && (data.voice_ui?.should_show_evidence_drawer ?? true)),
        );

        const hadMemorySearch =
          phases.includes('searching_memory') || data.tool_call?.name === 'search_memory';
        if (hadMemorySearch && evidenceItems.length > 0) {
          onMemoryEvidenceRetrieved?.(evidenceItems.length);
        }

        setTranscriptPreview(data.transcript || null);
        const assistant = (data.assistant_text || '').trim();
        const toSpeak = (data.spoken_text || data.assistant_text || '').trim();
        setBubbleText(toSpeak || null);

        const fe = data.frontend_action;
        const convTurn = Boolean(
          data.tool_result && typeof data.tool_result === 'object' && data.tool_result.conversation_turn,
        );

        if (fe?.type === 'calendar_draft_confirm' && fe.payload && typeof fe.payload === 'object') {
          const pl = fe.payload as { resolved?: ResolvedCalendar; draft_id?: string };
          const resolved = pl.resolved;
          if (typeof pl.draft_id === 'string' && pl.draft_id.trim()) {
            setPendingAgentDraftId(pl.draft_id.trim());
          } else {
            setPendingAgentDraftId(null);
          }
          if (resolved?.start_iso && resolved?.end_iso) {
            setPendingCalendar(resolved);
            setPendingConfirm(null);
            onDecisionSuggestion?.(null);
            setVoiceState('awaiting_confirmation');
            runTts(toSpeak || `I can add this to your calendar: ${resolved.display_summary}.`, {
              force: true,
              onMayHaveBlocked: () =>
                setTtsHint('No audio? Tap “Play reply” below — some browsers block auto-speak after recording.'),
            });
            return;
          }
        }

        if (fe?.type === 'show_calendar_draft' && fe.route) {
          applySlimeVoiceFrontendAction(navigate, fe as SlimeVoiceFrontendAction);
          setPendingConfirm(null);
          setPendingCalendar(null);
          setPendingAgentDraftId(null);
          onDecisionSuggestion?.(null);
          setVoiceState('idle');
          runTts(toSpeak || 'Opening your planner with a draft schedule.', {
            force: true,
            onMayHaveBlocked: () => setTtsHint('No audio? Tap “Play reply” below.'),
          });
          return;
        }

        if (fe?.type === 'confirm' && fe.payload && typeof fe.payload === 'object') {
          const title = String((fe.payload as { title?: string }).title || 'Confirm change');
          const patch = (fe.payload as { patch?: Record<string, unknown> }).patch;
          if (patch && typeof patch === 'object') {
            setPendingConfirm({ title, patch });
          }
          setPendingCalendar(null);
          onDecisionSuggestion?.(null);
          setVoiceState('idle');
          return;
        }

        setPendingConfirm(null);
        setPendingCalendar(null);
        setVoiceState('executing_tool');

        if (evidenceItems.length) onMemoryEvidenceBurst?.(evidenceItems);

        if (fe?.type === 'navigate') {
          applySlimeVoiceFrontendAction(navigate, fe);
        }

        if (convTurn && data.decision_suggestion?.should_show) {
          onDecisionSuggestion?.(data.decision_suggestion);
          setVoiceState('decision_prompt');
          const seq =
            data.spoken_sequence && data.spoken_sequence.length > 0
              ? data.spoken_sequence
              : [assistant, String(data.decision_suggestion.spoken_prompt || '').trim()].filter(Boolean);
          runSpokenSequence(seq, {
            force: true,
            onAllComplete: () => setVoiceState('idle'),
          });
          return;
        }

        onDecisionSuggestion?.(null);
        if (convTurn && data.spoken_sequence && data.spoken_sequence.length > 0) {
          runSpokenSequence(data.spoken_sequence, {
            force: true,
            onAllComplete: () => setVoiceState('idle'),
          });
          return;
        }

        runTts(toSpeak, {
          force: true,
          onMayHaveBlocked: () =>
            setTtsHint('No audio? Tap “Play reply” below — some browsers block auto-speak after recording.'),
        });
      } catch (e) {
        setVoiceState('error');
        setBubbleText(friendlySlimeVoiceError(apiFetchErrorMessage(e)));
      }
    },
    [
      currentRoute,
      threadId,
      slimeProfile,
      navigate,
      runTts,
      runSpokenSequence,
      onMemoryEvidenceBurst,
      onThreadId,
      onDecisionSuggestion,
      onProfileMemorySaved,
      onMemoryEvidenceRetrieved,
    ],
  );

  useEffect(() => {
    sendVoiceBlobRef.current = sendVoiceBlob;
  }, [sendVoiceBlob]);

  const pushToTalk = useCallback(async () => {
    setError(null);
    setTtsHint(null);
    if (recording) {
      unlockSlimeAudioContext();
      primeSpeechSynthesisFromGesture();
      const blob = await stopRecording();
      await sendVoiceBlob(blob);
      return;
    }

    cancelTts();
    cancelBuddyAudio();
    ttsGenRef.current += 1;
    setTranscriptPreview(null);
    setBubbleText(null);
    setPendingConfirm(null);
    setPendingCalendar(null);
    setDrawerOpen(false);
    setShowEvidenceCta(false);
    setVoiceState('listening');
    primeSpeechSynthesisFromGesture({ skipUtterance: true });
    const ok = await startRecording();
    if (!ok) setVoiceState('error');
  }, [recording, stopRecording, startRecording, sendVoiceBlob, cancelBuddyAudio, cancelTts, setError]);

  const onConfirmPatch = useCallback(async () => {
    if (!pendingConfirm?.patch || !onUpdateSlimeProfile) {
      setPendingConfirm(null);
      setVoiceState('idle');
      return;
    }
    primeSpeechSynthesisFromGesture();
    try {
      const normalized = normalizeVoiceSlimePatch(pendingConfirm.patch) as Partial<SlimeProfile>;
      await onUpdateSlimeProfile(normalized);
      setBubbleText('Saved your Slime changes.');
      setPendingConfirm(null);
      setVoiceState('speaking');
      if (ttsSupported) {
        cancelTts();
        speak('Saved your Slime changes.', {
          rate: slimeProfile.voice?.rate,
          pitch: slimeProfile.voice?.pitch,
          preferredVoiceName: slimeProfile.voice?.preferredVoiceName,
          onUtteranceEnd: () => setVoiceState('idle'),
        });
      } else {
        setVoiceState('idle');
      }
    } catch {
      setBubbleText('Could not save — try again from settings.');
      setVoiceState('error');
    }
  }, [pendingConfirm, onUpdateSlimeProfile, speak, cancelTts, ttsSupported, slimeProfile.voice]);

  const petName = slimeProfile.name?.trim() || 'your Slime';

  /** Bottom-anchored lane; split z-index so SlimeCompanionStage can paint between panels and mic (see Buddy page). */
  const voiceLane = 'absolute left-1/2 w-[min(100%,380px)] -translate-x-1/2';

  return (
    <>
      <div
        data-slime-avoid
        className={cn(
          voiceLane,
          /* Slightly lower than before; stay above mic stack (~8px bottom + ~92px tall → keep panel floor ≥ ~108px) */
          'bottom-[108px] z-[32] flex flex-col items-center gap-2 pointer-events-auto sm:bottom-[110px]',
          className,
        )}
      >
        {ttsHint ? <p className="max-w-xs text-center text-[11px] text-amber-900/90">{ttsHint}</p> : null}

        {error ? <p className="max-w-xs text-center text-xs text-red-700">{error}</p> : null}

        {transcriptPreview ? (
          <p className="max-w-sm text-center text-[11px] text-gray-600">
            <span className="font-semibold text-gray-700">You said:</span> {transcriptPreview}
          </p>
        ) : null}

        <AnimatePresence>
          {bubbleText ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="max-w-sm rounded-2xl border border-white/80 bg-white/90 px-3 py-2 text-center text-sm leading-snug text-gray-800 shadow-md backdrop-blur-md"
            >
              {bubbleText}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {bubbleText && ttsSupported && !recording ? (
          <button
            type="button"
            className="text-[11px] font-semibold text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900"
            onClick={() => {
              setTtsHint(null);
              unlockSlimeAudioContext();
              primeSpeechSynthesisFromGesture();
              runTts(bubbleText, { force: true });
            }}
          >
            {isSpeaking || buddyAudioPlaying ? 'Replay reply' : 'Play reply'}
          </button>
        ) : null}

        {showEvidenceCta && drawerItems.length ? (
          <button
            type="button"
            className="text-[11px] font-semibold text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900"
            onClick={() => setDrawerOpen(true)}
          >
            View evidence
          </button>
        ) : null}

        {pendingConfirm ? (
          <div className="flex max-w-sm flex-col items-center gap-2 rounded-2xl border border-amber-200/80 bg-amber-50/95 px-3 py-2 shadow-md backdrop-blur-md">
            <p className="text-center text-sm text-amber-950">{pendingConfirm.title}</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-full bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white"
                onClick={() => void onConfirmPatch()}
              >
                Confirm
              </button>
              <button
                type="button"
                className="rounded-full border border-gray-300 bg-white px-4 py-1.5 text-xs font-medium text-gray-800"
                onClick={() => {
                  setPendingConfirm(null);
                  setVoiceState('idle');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {pendingCalendar ? (
          <div className="flex max-w-sm flex-col gap-2 rounded-2xl border border-indigo-200/80 bg-white/95 px-4 py-3 text-left shadow-lg backdrop-blur-md">
            <p className="text-center text-xs font-semibold text-indigo-950">
              {petName} can add this to your calendar:
            </p>
            <div className="rounded-xl bg-indigo-50/80 px-3 py-2 text-xs text-gray-800">
              <p className="font-semibold text-indigo-950">{pendingCalendar.title}</p>
              <p className="mt-1 text-gray-700">{pendingCalendar.display_summary}</p>
              {pendingCalendar.ambiguity_note ? (
                <p className="mt-1 text-[11px] text-amber-800">{pendingCalendar.ambiguity_note}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                className="rounded-full bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white"
                onClick={() => void onConfirmCalendar()}
              >
                Add to calendar
              </button>
              <button
                type="button"
                className="rounded-full border border-gray-300 bg-white px-4 py-1.5 text-xs font-medium text-gray-800"
                onClick={onEditCalendar}
              >
                Edit
              </button>
              <button
                type="button"
                className="rounded-full border border-gray-200 bg-gray-50 px-4 py-1.5 text-xs font-medium text-gray-700"
                onClick={() => {
                  setPendingCalendar(null);
                  setPendingAgentDraftId(null);
                  setVoiceState('idle');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div
        data-slime-avoid
        className={cn(voiceLane, 'bottom-2 z-[52] flex flex-col items-center gap-2 pointer-events-auto sm:bottom-3')}
      >
        <div className="relative">
          {recording ? (
            <motion.span
              className="pointer-events-none absolute inset-0 rounded-full bg-violet-400/25"
              animate={{ scale: [1, 1.35, 1], opacity: [0.5, 0.15, 0.5] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          ) : null}
          <button
            type="button"
            disabled={!supported}
            onClick={() => void pushToTalk()}
            title={`Talk to ${petName}`}
            aria-label={recording ? 'Stop recording' : `Talk to ${petName}`}
            className={cn(
              'relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-white/90 bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg transition hover:scale-[1.03] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-40',
              recording && 'ring-4 ring-cyan-300/80',
            )}
          >
            {recording ? <Square className="h-6 w-6 fill-current" aria-hidden /> : <Mic className="h-6 w-6" aria-hidden />}
          </button>
        </div>

        {recording && speechPhaseLabel(speechPhase, recording) ? (
          <p className="text-center text-xs font-medium text-cyan-900/90">{speechPhaseLabel(speechPhase, recording)}</p>
        ) : null}
        {!recording && voiceState !== 'idle' && statusLabel(voiceState) ? (
          <p className="text-center text-xs font-medium text-violet-950/90">{statusLabel(voiceState)}</p>
        ) : null}
      </div>

      <EvidenceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </>
  );
}
