import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceRecorderSpeechPhase } from '../../hooks/useVoiceRecorder';
import { Mic, Square } from 'lucide-react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import type { SlimeAdvisorState } from '../../app/components/report/SlimeAdvisor';
import { EvidenceDrawer } from '../../app/components/profile/EvidenceDrawer';
import type { MemoryEvidenceItem } from '../../app/components/profile/memoryEvidenceTypes';
import { primeSpeechSynthesisFromGesture, useSpeechSynthesis } from '../../app/hooks/useSpeechSynthesis';
import { playMp3BlobWithWebAudio, unlockSlimeAudioContext } from '../../utils/slimeAudioContext';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import type { SlimeProfile } from '../../app/model';
import { apiFetch } from '../../utils/apiFetch';
import { apiFetchErrorMessage } from '../../utils/apiOrigin';
import { confirmCalendarDraft } from '../../utils/calendarAgentApi';
import {
  executionStorageKeys,
  SLIME_CALENDAR_BRIEF_CONTEXT_KEY,
  SLIME_VOICE_CALENDAR_RESOLVED_KEY,
} from '../../utils/executionStorageKeys';
import { useExecutionStorageUserKey } from '../../hooks/useExecutionStorageUserKey';
import {
  applySlimeVoiceFrontendAction,
  normalizeVoiceSlimePatch,
  type SlimeVoiceFrontendAction,
} from '../../utils/slimeVoiceActions';
import { refetchSlimeProfileGlobal } from '../../hooks/useSlimeProfile';
import { cn } from '../../app/components/ui/utils';
import { useSlimeCredits } from '../../app/components/credits/SlimeCreditsContext';
import { ModelSelector } from '../models/ModelSelector';
import { useSlimeModelCatalog } from '../models/useSlimeModelCatalog';
import { BuddyTooltip } from './BuddyTooltip';

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

export type SlimeSpeechOutput = {
  text: string;
  speaking: boolean;
  source: 'assistant' | 'system' | 'error';
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
  /** Buddy page: toast/card when profile-memory facts were saved or updated. */
  onProfileMemorySaved?: (payload: {
    message: string;
    items: string[];
    details: Array<{ action?: string; id?: string; text?: string; category?: string }>;
  }) => void;
  /** Buddy page: corner toast when a memory search returned evidence snippets. */
  onMemoryEvidenceRetrieved?: (count: number) => void;
  /** Speech bubble rendered by the roaming stage so it stays attached to the slime. */
  onSpeechOutputChange?: (output: SlimeSpeechOutput | null) => void;
  currentRoute?: string;
  hideModelSelector?: boolean;
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

type SlimeCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string | null;
  source?: string;
  locked?: boolean;
  [key: string]: unknown;
};

type PendingCalendarMutation = {
  kind: 'delete' | 'update';
  event: SlimeCalendarEvent;
  proposed?: Partial<SlimeCalendarEvent>;
  message: string;
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
  memory_update_details?: Array<{
    action?: string;
    id?: string;
    text?: string;
    category?: string;
    previous_id?: string;
    confidence?: number;
    importance?: number;
  }>;
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

function formatProfileMemoryToast(
  memoryUpdates: string[],
  details?: Array<{ action?: string; text?: string; category?: string }>,
): string {
  const cleaned = memoryUpdates.map((s) => s.trim()).filter(Boolean);
  if (!cleaned.length) return '';
  const ellipsize = (s: string, max: number) => {
    const t = s.replace(/\s+/g, ' ');
    if (t.length <= max) return t;
    return `${t.slice(0, max - 1)}…`;
  };
  const firstDetail = details?.find((d) => (d.text || '').trim());
  if (cleaned.length === 1) {
    const action = (firstDetail?.action || 'saved').trim();
    const category = (firstDetail?.category || '').trim();
    const prefix = category ? `${action} · ${category}` : action;
    return `${prefix}: ${ellipsize(firstDetail?.text || cleaned[0], 58)}`;
  }
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

function normalizeCalendarText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calendarMutationKind(text: string): PendingCalendarMutation['kind'] | null {
  const t = normalizeCalendarText(text);
  const wantsDelete = /\b(delete|remove|cancel|drop|clear|get rid of)\b/.test(t) || /删除|取消|删掉|移除|去掉/.test(text);
  if (wantsDelete) return 'delete';
  const wantsUpdate =
    /\b(change|edit|modify|update|move|reschedule|rename|shift|postpone)\b/.test(t) ||
    /修改|更改|改成|改到|改为|挪到|换到|推迟|提前/.test(text);
  if (wantsUpdate) return 'update';
  return null;
}

function scoreCalendarEvent(ev: SlimeCalendarEvent, transcript: string): number {
  const hay = normalizeCalendarText(transcript);
  const title = normalizeCalendarText(ev.title);
  if (!title) return 0;
  let score = hay.includes(title) ? 12 : 0;
  const tokens = title.split(' ').filter((x) => x.length >= 2);
  for (const tok of tokens) {
    if (hay.includes(tok)) score += Math.min(tok.length, 6);
  }
  const start = new Date(ev.start);
  if (!Number.isNaN(start.getTime())) {
    const day = start.toLocaleDateString(undefined, { weekday: 'long' }).toLowerCase();
    const shortDay = start.toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase();
    if (hay.includes(day) || hay.includes(shortDay)) score += 2;
  }
  return score;
}

function chooseCalendarEvent(events: SlimeCalendarEvent[], transcript: string): SlimeCalendarEvent | null {
  const valid = events.filter((e) => e?.id && e.title && e.start && e.end);
  if (!valid.length) return null;
  const ranked = valid
    .map((event) => ({ event, score: scoreCalendarEvent(event, transcript) }))
    .sort((a, b) => b.score - a.score);
  if (ranked[0]?.score > 0) return ranked[0].event;
  if (valid.length === 1) return valid[0];
  return null;
}

function calendarEventSummary(ev: Pick<SlimeCalendarEvent, 'title' | 'start' | 'end'>): string {
  const s = new Date(ev.start);
  const e = new Date(ev.end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return ev.title;
  return `${ev.title} · ${s.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}–${e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
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
  onSpeechOutputChange,
  currentRoute,
  hideModelSelector = false,
  className,
}: SlimeVoiceAgentProps) {
  const navigate = useNavigate();
  const { showInsufficient, refresh: refreshCredits } = useSlimeCredits();
  const slimeModels = useSlimeModelCatalog();
  const [voiceModelOptionId, setVoiceModelOptionId] = useState('');
  useEffect(() => {
    if (slimeModels.ready && slimeModels.defaultModel && !voiceModelOptionId) {
      setVoiceModelOptionId(slimeModels.defaultModel);
    }
  }, [slimeModels.ready, slimeModels.defaultModel, voiceModelOptionId]);
  const { storageUserKey } = useExecutionStorageUserKey();
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
  const [lastReplyText, setLastReplyText] = useState<string | null>(null);
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
  const [pendingCalendarMutation, setPendingCalendarMutation] = useState<PendingCalendarMutation | null>(null);
  const [pendingAgentDraftId, setPendingAgentDraftId] = useState<string | null>(null);
  const [drawerItems, setDrawerItems] = useState<MemoryEvidenceItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showEvidenceCta, setShowEvidenceCta] = useState(false);

  useEffect(() => {
    onAdvisorStateChange?.(mapVoiceToAdvisor(voiceState));
  }, [voiceState, onAdvisorStateChange]);

  const clearSpeechOutput = useCallback(() => {
    onSpeechOutputChange?.(null);
  }, [onSpeechOutputChange]);

  const showSpeechOutput = useCallback(
    (text: string, opts?: { speaking?: boolean; source?: SlimeSpeechOutput['source'] }) => {
      const trimmed = text.trim();
      setLastReplyText(trimmed || null);
      onSpeechOutputChange?.(
        trimmed
          ? {
              text: trimmed,
              speaking: opts?.speaking ?? false,
              source: opts?.source ?? 'assistant',
            }
          : null,
      );
    },
    [onSpeechOutputChange],
  );

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
        source?: SlimeSpeechOutput['source'];
        onMayHaveBlocked?: () => void;
        onStart?: () => void;
        onComplete?: () => void;
      },
    ) => {
      const trimmed = text.trim();
      const voiceOff = slimeProfile.voice?.enabled === false;
      const useTts = ttsSupported && Boolean(text?.trim()) && (opts?.force === true || !voiceOff);
      if (!useTts) {
        if (trimmed) showSpeechOutput(trimmed, { speaking: false, source: opts?.source });
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
      let started = false;
      const startOutput = () => {
        if (gen !== ttsGenRef.current) return;
        if (started) return;
        started = true;
        showSpeechOutput(trimmed, { speaking: true, source: opts?.source });
        opts?.onStart?.();
      };
      const completeOutput = () => {
        if (gen === ttsGenRef.current && trimmed) {
          showSpeechOutput(trimmed, { speaking: false, source: opts?.source });
        }
        onComplete?.();
      };

      const synthOpts = {
        rate: slimeProfile.voice?.rate,
        pitch: slimeProfile.voice?.pitch,
        preferredVoiceName: slimeProfile.voice?.preferredVoiceName,
        onUtteranceStart: startOutput,
        onMayHaveBlocked: opts?.onMayHaveBlocked,
        onUtteranceEnd: () => {
          if (gen === ttsGenRef.current) setVoiceState('idle');
          completeOutput();
        },
      };

      void (async () => {
        try {
          const ttsCredit =
            typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tts-${Date.now()}`;
          const r = await apiFetch('/api/slime/tts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Credit-Request-Id': ttsCredit,
            },
            body: JSON.stringify({
              text,
              ...(voiceModelOptionId ? { model_option_id: voiceModelOptionId } : {}),
            }),
          });
          if (gen !== ttsGenRef.current) return;
          if (r.status === 402) {
            let j: Record<string, unknown> = {};
            try {
              j = (await r.json()) as Record<string, unknown>;
            } catch {
              /* ignore */
            }
            showInsufficient({
              required: Number(j.required ?? 0),
              balance: typeof j.balance === 'number' ? j.balance : null,
              message:
                typeof j.message === 'string'
                  ? j.message
                  : 'You need more Slime Credits for this action.',
            });
          }
          if (r.ok) {
            const blob = await r.blob();
            if (gen !== ttsGenRef.current) return;
            buddyTtsLoadPendingRef.current = false;
            setBuddyAudioPlaying(true);
            const finishOutput = () => {
              cancelBuddyAudio();
              if (gen === ttsGenRef.current) setVoiceState('idle');
              completeOutput();
            };
            const webOk = await playMp3BlobWithWebAudio(blob, {
              onStart: startOutput,
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
            audio.setAttribute('playsinline', 'true');
            audio.preload = 'auto';
            audio.src = url;
            audio.onended = finishOutput;
            audio.onerror = () => {
              cancelBuddyAudio();
              setVoiceState('idle');
              setTtsHint('Could not play audio — check API / OPENAI_API_KEY, or try again.');
              completeOutput();
            };
            try {
              await audio.play();
              startOutput();
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
    [ttsSupported, slimeProfile.voice, speak, cancelTts, cancelBuddyAudio, showInsufficient, voiceModelOptionId, showSpeechOutput],
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
    if (!storageUserKey) return;
    try {
      const k = executionStorageKeys(storageUserKey).events;
      const raw = localStorage.getItem(k);
      const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
      if (!Array.isArray(arr)) return;
      arr.push(event);
      localStorage.setItem(k, JSON.stringify(arr));
    } catch {
      /* ignore */
    }
  }, [storageUserKey]);

  const updateLocalCalendarEvent = useCallback((event: SlimeCalendarEvent | null, deleteId?: string) => {
    if (!storageUserKey) return;
    try {
      const k = executionStorageKeys(storageUserKey).events;
      const raw = localStorage.getItem(k);
      const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
      if (!Array.isArray(arr)) return;
      const next = deleteId
        ? arr.filter((x) => !(x && typeof x === 'object' && (x as { id?: unknown }).id === deleteId))
        : event
          ? arr.map((x) => (x && typeof x === 'object' && (x as { id?: unknown }).id === event.id ? event : x))
          : arr;
      localStorage.setItem(k, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, [storageUserKey]);

  const prepareCalendarMutation = useCallback(
    async (transcript: string): Promise<boolean> => {
      const kind = calendarMutationKind(transcript);
      if (!kind) return false;
      const res = await apiFetch('/api/calendar/events', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { events?: SlimeCalendarEvent[] };
      const event = chooseCalendarEvent(data.events ?? [], transcript);
      if (!event) {
        showSpeechOutput('I can do that, but I could not tell which calendar event you meant. Try saying the event title too.', {
          source: 'error',
        });
        setVoiceState('idle');
        return true;
      }

      if (kind === 'delete') {
        setPendingCalendarMutation({
          kind,
          event,
          message: `Delete ${calendarEventSummary(event)}?`,
        });
        setPendingCalendar(null);
        setPendingConfirm(null);
        onDecisionSuggestion?.(null);
        runTts(`I found ${event.title}. Confirm below if you want me to delete it.`, { force: true });
        return true;
      }

      const parseCredit = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `cal-parse-${Date.now()}`;
      const parseRes = await apiFetch('/api/calendar-agent/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Credit-Request-Id': parseCredit },
        body: JSON.stringify({
          text: transcript,
          thread_id: threadId ?? null,
          current_event_id: event.id,
          source: 'slime_voice',
          ...(voiceModelOptionId ? { model_option_id: voiceModelOptionId } : {}),
        }),
      });
      if (!parseRes.ok) throw new Error(await parseRes.text());
      const parsed = (await parseRes.json()) as { intent?: Record<string, unknown> };
      const intent = parsed.intent ?? {};
      const draftCredit = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `cal-draft-${Date.now()}`;
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const draftRes = await apiFetch('/api/calendar-agent/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Credit-Request-Id': draftCredit },
        body: JSON.stringify({
          intent: {
            ...intent,
            intent_type: 'reschedule',
            title: typeof intent.title === 'string' && intent.title.trim() ? intent.title : event.title,
            current_event_id: event.id,
            thread_id: threadId ?? null,
          },
          existing_events: (data.events ?? []).filter((e) => e.id !== event.id),
          timezone,
          ...(voiceModelOptionId ? { model_option_id: voiceModelOptionId } : {}),
        }),
      });
      if (!draftRes.ok) throw new Error(await draftRes.text());
      const draft = (await draftRes.json()) as { draft?: { proposed_events?: SlimeCalendarEvent[] } };
      const proposed = draft.draft?.proposed_events?.[0];
      if (!proposed?.start || !proposed?.end) {
        showSpeechOutput('I found the event, but I could not confidently parse the new time. Open the planner to edit it precisely.', {
          source: 'error',
        });
        setVoiceState('idle');
        return true;
      }
      setPendingCalendarMutation({
        kind,
        event,
        proposed: {
          title: proposed.title || event.title,
          start: proposed.start,
          end: proposed.end,
          description: proposed.description ?? event.description,
        },
        message: `Change ${calendarEventSummary(event)} to ${calendarEventSummary({ ...event, ...proposed })}?`,
      });
      setPendingCalendar(null);
      setPendingConfirm(null);
      onDecisionSuggestion?.(null);
      runTts(`I found ${event.title}. Confirm below if you want me to update it.`, { force: true });
      return true;
    },
    [onDecisionSuggestion, runTts, showSpeechOutput, threadId, voiceModelOptionId],
  );

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
        runTts('Done — I added it to your execution calendar.', {
          force: true,
          onMayHaveBlocked: () =>
            setTtsHint('No audio? Tap “Play reply” below after the message appears.'),
        });
        return;
      }
      if (!pendingCalendar) return;
      const res = await apiFetch('/api/slime/confirm-calendar-block', {
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
      runTts('Done — I added it to your execution calendar.', {
        force: true,
        onMayHaveBlocked: () =>
          setTtsHint('No audio? Tap “Play reply” below after the message appears.'),
      });
    } catch (e) {
      showSpeechOutput(apiFetchErrorMessage(e), { source: 'error' });
      setVoiceState('error');
    }
  }, [pendingAgentDraftId, pendingCalendar, mergeCalendarEvent, runTts, showSpeechOutput]);

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

  const onConfirmCalendarMutation = useCallback(async () => {
    if (!pendingCalendarMutation) return;
    primeSpeechSynthesisFromGesture();
    try {
      if (pendingCalendarMutation.kind === 'delete') {
        const res = await apiFetch(`/api/calendar/events/${encodeURIComponent(pendingCalendarMutation.event.id)}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(await res.text());
        updateLocalCalendarEvent(null, pendingCalendarMutation.event.id);
        const title = pendingCalendarMutation.event.title;
        setPendingCalendarMutation(null);
        runTts(`Done — I deleted ${title} from your execution calendar.`, { force: true, source: 'system' });
        return;
      }
      const patch = pendingCalendarMutation.proposed;
      if (!patch) return;
      const res = await apiFetch(`/api/calendar/events/${encodeURIComponent(pendingCalendarMutation.event.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json()) as { event?: SlimeCalendarEvent };
      if (body.event) updateLocalCalendarEvent(body.event);
      const title = (body.event?.title || pendingCalendarMutation.event.title).trim();
      setPendingCalendarMutation(null);
      runTts(`Done — I updated ${title} on your execution calendar.`, { force: true, source: 'system' });
    } catch (e) {
      showSpeechOutput(apiFetchErrorMessage(e), { source: 'error' });
      setVoiceState('error');
    }
  }, [pendingCalendarMutation, runTts, showSpeechOutput, updateLocalCalendarEvent]);

  const sendVoiceBlob = useCallback(
    async (blob: Blob | null) => {
      unlockSlimeAudioContext();
      primeSpeechSynthesisFromGesture();
      setVoiceState('transcribing');
      if (!blob) {
        setVoiceState('idle');
        showSpeechOutput('No audio captured.', { source: 'error' });
        return;
      }
      const fd = new FormData();
      fd.append('audio', blob, 'voice.webm');
      if (currentRoute) fd.append('current_route', currentRoute);
      if (threadId) fd.append('thread_id', threadId);
      fd.append('slime_profile', JSON.stringify(slimeProfile));
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        let calendarContext: unknown = null;
        try {
          const rawCalendar = sessionStorage.getItem(SLIME_CALENDAR_BRIEF_CONTEXT_KEY);
          calendarContext = rawCalendar ? JSON.parse(rawCalendar) : null;
        } catch {
          calendarContext = null;
        }
        fd.append('recent_ui_context', JSON.stringify({ timezone: tz, calendar_context: calendarContext }));
      } catch {
        fd.append('recent_ui_context', JSON.stringify({}));
      }
      if (voiceModelOptionId) {
        fd.append('model_option_id', voiceModelOptionId);
      }
      setVoiceState('thinking');
      try {
        const vcCredit =
          typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `vc-${Date.now()}`;
        const res = await apiFetch('/api/slime/voice-command', {
          method: 'POST',
          headers: { 'X-Credit-Request-Id': vcCredit },
          body: fd,
        });
        if (res.status === 402) {
          let j: Record<string, unknown> = {};
          try {
            j = (await res.json()) as Record<string, unknown>;
          } catch {
            /* ignore */
          }
          showInsufficient({
            required: Number(j.required ?? 0),
            balance: typeof j.balance === 'number' ? j.balance : null,
            message:
              typeof j.message === 'string'
                ? j.message
                : 'You need more Slime Credits for this action.',
          });
          setVoiceState('idle');
          return;
        }
        if (!res.ok) {
          const t = await res.text();
          throw new Error(httpErrorBodyToMessage(t, res.statusText));
        }
        const data = (await res.json()) as VoiceResponse;
        void refreshCredits();
        if (data.thread_id) onThreadId?.(data.thread_id);
        const mus = data.memory_updates;
        if (mus?.length) {
          const toastMsg = formatProfileMemoryToast(mus, data.memory_update_details);
          if (toastMsg) {
            onProfileMemorySaved?.({
              message: toastMsg,
              items: mus,
              details: (data.memory_update_details || []).map((d) => ({
                action: d.action,
                id: (d as { id?: string }).id,
                text: d.text,
                category: d.category,
              })),
            });
          }
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
        if (data.transcript && (await prepareCalendarMutation(data.transcript))) {
          return;
        }
        const assistant = (data.assistant_text || '').trim();
        const toSpeak = (data.spoken_text || data.assistant_text || '').trim();
        setLastReplyText(toSpeak || null);

        const fe = data.frontend_action;
        const convTurn = Boolean(
          data.tool_result && typeof data.tool_result === 'object' && data.tool_result.conversation_turn,
        );

        if (fe?.type === 'slime_profile_refresh') {
          void refetchSlimeProfileGlobal();
        }

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
            setPendingCalendarMutation(null);
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
          setPendingCalendarMutation(null);
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
          setPendingCalendarMutation(null);
          onDecisionSuggestion?.(null);
          setVoiceState('idle');
          return;
        }

        setPendingConfirm(null);
        setPendingCalendar(null);
        setPendingCalendarMutation(null);
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
        showSpeechOutput(friendlySlimeVoiceError(apiFetchErrorMessage(e)), { source: 'error' });
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
      showInsufficient,
      refreshCredits,
      voiceModelOptionId,
      showSpeechOutput,
      prepareCalendarMutation,
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
    setLastReplyText(null);
    clearSpeechOutput();
    setPendingConfirm(null);
    setPendingCalendar(null);
    setPendingCalendarMutation(null);
    setDrawerOpen(false);
    setShowEvidenceCta(false);
    setVoiceState('listening');
    primeSpeechSynthesisFromGesture({ skipUtterance: true });
    const ok = await startRecording();
    if (!ok) setVoiceState('error');
  }, [recording, stopRecording, startRecording, sendVoiceBlob, cancelBuddyAudio, cancelTts, setError, clearSpeechOutput]);

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
      setPendingConfirm(null);
      runTts('Saved your Slime changes.', { force: true, source: 'system' });
    } catch {
      showSpeechOutput('Could not save — try again from settings.', { source: 'error' });
      setVoiceState('error');
    }
  }, [pendingConfirm, onUpdateSlimeProfile, runTts, showSpeechOutput]);

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

        {lastReplyText && ttsSupported && !recording ? (
          <BuddyTooltip content="Speak the assistant's last reply with your browser voice (unlocks audio on first use).">
            <button
              type="button"
              className="text-[11px] font-semibold text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900"
              onClick={() => {
                setTtsHint(null);
                unlockSlimeAudioContext();
                primeSpeechSynthesisFromGesture();
                runTts(lastReplyText, { force: true });
              }}
            >
              {isSpeaking || buddyAudioPlaying ? 'Replay reply' : 'Play reply'}
            </button>
          </BuddyTooltip>
        ) : null}

        {showEvidenceCta && drawerItems.length ? (
          <BuddyTooltip content="Open a drawer with memories and snippets that influenced this answer.">
            <button
              type="button"
              className="text-[11px] font-semibold text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900"
              onClick={() => setDrawerOpen(true)}
            >
              View evidence
            </button>
          </BuddyTooltip>
        ) : null}

        {pendingConfirm ? (
          <div className="flex max-w-sm flex-col items-center gap-2 rounded-2xl border border-amber-200/85 bg-amber-50 px-3 py-2 shadow-md backdrop-blur-md">
            <p className="text-center text-sm text-amber-950">{pendingConfirm.title}</p>
            <div className="flex gap-2">
              <BuddyTooltip content="Apply the proposed profile or style update from this conversation.">
                <button
                  type="button"
                  className="rounded-full bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white"
                  onClick={() => void onConfirmPatch()}
                >
                  Confirm
                </button>
              </BuddyTooltip>
              <BuddyTooltip content="Discard the proposed update and go back to idle.">
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
              </BuddyTooltip>
            </div>
          </div>
        ) : null}

      </div>

      {pendingCalendar || pendingCalendarMutation ? (
        <div
          data-slime-avoid
          className="pointer-events-auto fixed bottom-[max(5.7rem,calc(env(safe-area-inset-bottom,0px)+5rem))] right-4 z-[58] w-[min(92vw,22rem)] rounded-3xl border border-white/80 bg-white/90 p-3 text-left shadow-[0_18px_60px_rgba(79,70,229,0.18)] backdrop-blur-xl sm:right-6"
        >
          {pendingCalendar ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
                {petName} can add this
              </p>
              <div className="mt-2 rounded-2xl bg-indigo-50/80 px-3 py-2 text-xs text-gray-800">
                <p className="font-semibold text-indigo-950">{pendingCalendar.title}</p>
                <p className="mt-1 text-gray-700">{pendingCalendar.display_summary}</p>
                {pendingCalendar.ambiguity_note ? (
                  <p className="mt-1 text-[11px] text-amber-800">{pendingCalendar.ambiguity_note}</p>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <BuddyTooltip content="Confirm and add this event to your execution calendar.">
                  <button
                    type="button"
                    className="rounded-full bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white"
                    onClick={() => void onConfirmCalendar()}
                  >
                    Add
                  </button>
                </BuddyTooltip>
                <BuddyTooltip content="Open the planner to adjust times or details before saving.">
                  <button
                    type="button"
                    className="rounded-full border border-gray-300 bg-white px-4 py-1.5 text-xs font-medium text-gray-800"
                    onClick={onEditCalendar}
                  >
                    Edit
                  </button>
                </BuddyTooltip>
                <BuddyTooltip content="Dismiss this calendar suggestion without saving.">
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
                </BuddyTooltip>
              </div>
            </>
          ) : null}

          {pendingCalendarMutation ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">
                {pendingCalendarMutation.kind === 'delete' ? 'Delete calendar event' : 'Update calendar event'}
              </p>
              <div className="mt-2 rounded-2xl bg-violet-50/80 px-3 py-2 text-xs text-gray-800">
                <p className="font-semibold text-violet-950">{pendingCalendarMutation.message}</p>
                {pendingCalendarMutation.proposed ? (
                  <p className="mt-1 text-gray-700">
                    New: {calendarEventSummary({ ...pendingCalendarMutation.event, ...pendingCalendarMutation.proposed })}
                  </p>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <BuddyTooltip content="Apply this calendar change.">
                  <button
                    type="button"
                    className={cn(
                      'rounded-full px-4 py-1.5 text-xs font-semibold text-white',
                      pendingCalendarMutation.kind === 'delete' ? 'bg-red-500 hover:bg-red-600' : 'bg-violet-600 hover:bg-violet-700',
                    )}
                    onClick={() => void onConfirmCalendarMutation()}
                  >
                    {pendingCalendarMutation.kind === 'delete' ? 'Delete' : 'Update'}
                  </button>
                </BuddyTooltip>
                <BuddyTooltip content="Dismiss this calendar change without applying it.">
                  <button
                    type="button"
                    className="rounded-full border border-gray-200 bg-gray-50 px-4 py-1.5 text-xs font-medium text-gray-700"
                    onClick={() => {
                      setPendingCalendarMutation(null);
                      setVoiceState('idle');
                    }}
                  >
                    Cancel
                  </button>
                </BuddyTooltip>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

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
          <BuddyTooltip
            side="top"
            content={
              supported
                ? `Tap to start or stop recording and send to ${petName}. Works like push-to-talk.`
                : 'Voice input is not available in this browser.'
            }
          >
            <span className="inline-flex rounded-full">
              <button
                type="button"
                disabled={!supported}
                onClick={() => void pushToTalk()}
                aria-label={recording ? 'Stop recording' : `Talk to ${petName}`}
                className={cn(
                  'relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-white/90 bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg transition hover:scale-[1.03] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-40',
                  recording && 'ring-4 ring-cyan-300/80',
                )}
              >
                {recording ? <Square className="h-6 w-6 fill-current" aria-hidden /> : <Mic className="h-6 w-6" aria-hidden />}
              </button>
            </span>
          </BuddyTooltip>
        </div>

        {recording && speechPhaseLabel(speechPhase, recording) ? (
          <p className="text-center text-xs font-medium text-cyan-900/90">{speechPhaseLabel(speechPhase, recording)}</p>
        ) : null}
        {!recording && voiceState !== 'idle' && statusLabel(voiceState) ? (
          <p className="text-center text-xs font-medium text-violet-950/90">{statusLabel(voiceState)}</p>
        ) : null}
      </div>

      {!hideModelSelector ? (
        <div
          data-slime-avoid
          className="pointer-events-auto fixed right-3 bottom-[max(5.75rem,calc(env(safe-area-inset-bottom,0px)+4.75rem))] z-[52] w-[min(92vw,16rem)] sm:right-5"
        >
          <div className="rounded-xl border border-white/50 bg-white/72 px-2 py-1 backdrop-blur-md">
            <ModelSelector
              feature="slime_voice"
              selectedModelId={voiceModelOptionId || slimeModels.defaultModel}
              onChange={setVoiceModelOptionId}
              models={slimeModels.models}
              selectorEnabled={slimeModels.selectorEnabled}
              showCostPreview={false}
              variant="compact"
              elevated={false}
              hideCompactHeader
              compactSelectAriaLabel="Slime model tier for voice"
              disabled={recording}
            />
          </div>
        </div>
      ) : null}

      <EvidenceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </>
  );
}
