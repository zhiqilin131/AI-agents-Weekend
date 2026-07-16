import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VoiceRecorderSpeechPhase } from '../../hooks/useVoiceRecorder';
import { Mic, RotateCcw, Square } from 'lucide-react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { DecisionModeToggle } from '../../app/components/DecisionModeToggle';
import type { SlimeAdvisorState } from '../../app/components/report/SlimeAdvisor';
import type { MemoryEvidenceItem } from '../../app/components/profile/memoryEvidenceTypes';
import {
  connectHtmlAudioAmplitudeAnalyzer,
  playMp3BlobWithWebAudio,
  unlockSlimeAudioContext,
} from '../../utils/slimeAudioContext';
import { resetSlimeSpeakAmplitude } from './visual3d/slimeSpeakAmplitude';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import type { SlimeProfile } from '../../app/model';
import { apiFetch } from '../../utils/apiFetch';
import { apiFetchErrorMessage } from '../../utils/apiOrigin';
import { confirmCalendarDraft, mergeExecutionCalendarEvents } from '../../utils/calendarAgentApi';
import { parseSseBlocks } from '../../utils/parseSse';
import {
  dispatchExecutionCalendarLocalBump,
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
import { BUDDY_VOICE_DOCK_BOTTOM, BUDDY_VOICE_HINTS_BOTTOM } from './buddyLayout';
import { cn } from '../../app/components/ui/utils';
import { useSlimeCredits } from '../../app/components/credits/SlimeCreditsContext';
import { ModelSelector } from '../models/ModelSelector';
import { useSlimeModelCatalog } from '../models/useSlimeModelCatalog';
import { BuddyVoiceDockBar } from './BuddyVoiceDockBar';
import { BuddyTooltip } from './BuddyTooltip';
import { calendarMutationKindFromTranscript } from './slimeVoiceIntentGuards';
import {
  groupSpeakableParts,
  normalizeSpeechText,
  resolveVoiceDisplayText,
  splitSpeakableParts,
} from './slimeTtsChunks';
import { StreamTtsLedger } from './slimeStreamTtsLedger';
import { normalizeTtsVoiceName } from '../../utils/ttsVoices';
import { getSlimeIdentity, slimeSupportsDecisionMode, ttsVoiceForSlimeType } from './slimeIdentity';
import { SLIME_CTA_BTN_CLASS, slimeCtaButtonStyle } from './slimeCtaButton';
import type { SlimeType } from './slimeIdentity';

export type VoiceAgentState =
  | 'idle'
  | 'listening'
  | 'hearing_speech'
  | 'auto_stopping'
  | 'transcribing'
  | 'searching_memory'
  | 'synthesizing'
  | 'thinking'
  | 'preparing_voice'
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
  evidenceItems?: MemoryEvidenceItem[];
  /** Stable id for one assistant utterance (avoids remounting the bubble on streamed deltas). */
  utteranceId?: number;
};

export type SlimeVoiceVariant = 'buddy' | 'calendar';

export type SlimeVoiceAgentProps = {
  /** Buddy = full roaming UI; calendar = compact execution planner dock. */
  variant?: SlimeVoiceVariant;
  slimeProfile: SlimeProfile;
  slimeType?: SlimeType;
  onUpdateSlimeProfile?: (patch: Partial<SlimeProfile>) => Promise<void> | void;
  onAdvisorStateChange?: (s: SlimeAdvisorState) => void;
  onMemoryEvidenceItemsChange?: (items: MemoryEvidenceItem[]) => void;
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
  /** Calendar planner: one-line status (no overlay bubble on the slime card). */
  onCalendarStatusLine?: (line: string | null) => void;
  /** Fired after a voice turn completes successfully (thread may have new messages). */
  onConversationUpdated?: (threadId?: string) => void;
  /** Fired when the server summarizes the thread title from the user's first message. */
  onThreadTitleUpdated?: (title: string, threadId: string) => void;
  currentRoute?: string;
  hideModelSelector?: boolean;
  /** Manual Decision Mode — next voice turn triggers enhance + confirmation (buddy page). */
  decisionModeActive?: boolean;
  onToggleDecisionMode?: () => void;
  decisionModeToggleDisabled?: boolean;
  /** When set, mic is disabled until user starts a therapy session (Rimumu buddy). */
  voiceGateDisabled?: boolean;
  voiceGateMessage?: string | null;
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

type RunTtsOptions = {
  /**
   * Bypass `voice.enabled === false` so playback still runs for explicit voice-command replies
   * and “Play reply” taps.
   */
  force?: boolean;
  source?: SlimeSpeechOutput['source'];
  onMayHaveBlocked?: () => void;
  onStart?: () => void;
  onComplete?: () => void;
  evidenceItems?: MemoryEvidenceItem[];
  displayText?: string;
  /** Bubble already shown — skip duplicate reveal on audio start. */
  suppressBubble?: boolean;
  /** Keep `speaking` UI while TTS loads (buddy unified reveal). */
  keepSpeakingState?: boolean;
  /** Multi-part TTS — do not clear speaking state until the last chunk ends. */
  suppressSpeakingEnd?: boolean;
  /** More sequence chunks follow — keep gen alive, avoid idle flash between parts. */
  sequenceHasMore?: boolean;
  skipCancel?: boolean;

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
    case 'awaiting_confirmation':
      return 'thinking';
    case 'searching_memory':
    case 'synthesizing':
      return 'remembering';
    case 'preparing_voice':
      return 'preparing';
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
    case 'preparing_voice':
      return 'Preparing voice…';
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

function voiceStatusSteps(s: VoiceAgentState): Array<{ key: string; label: string; active: boolean; done: boolean }> {
  const order = ['heard', 'memory', 'thinking', 'voice', 'speaking'];
  const activeKey =
    s === 'auto_stopping' || s === 'transcribing'
      ? 'heard'
      : s === 'searching_memory' || s === 'synthesizing'
        ? 'memory'
        : s === 'thinking' || s === 'executing_tool' || s === 'decision_prompt'
          ? 'thinking'
          : s === 'preparing_voice'
            ? 'voice'
            : s === 'speaking'
              ? 'speaking'
              : '';
  const activeIdx = activeKey ? order.indexOf(activeKey) : -1;
  return [
    { key: 'heard', label: 'heard' },
    { key: 'memory', label: 'memory' },
    { key: 'thinking', label: 'thinking' },
    { key: 'voice', label: 'voice' },
    { key: 'speaking', label: 'speaking' },
  ].map((step, idx) => ({
    ...step,
    active: step.key === activeKey,
    done: activeIdx > idx,
  }));
}

function voiceStatusProgress(s: VoiceAgentState): number {
  const steps = voiceStatusSteps(s);
  const activeIdx = steps.findIndex((step) => step.active);
  if (activeIdx < 0) return 0;
  return steps.length <= 1 ? 100 : (activeIdx / (steps.length - 1)) * 100;
}

type VoiceResponse = {
  transcript?: string;
  asr_provider?: string;
  assistant_text?: string;
  /** Persona-aware line for TTS (falls back to assistant_text if omitted). */
  spoken_text?: string;
  spoken_sequence?: string[];
  thread_id?: string;
  thread_title?: string;
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
  /** Top-level evidence chips (conversation turn path). */
  evidence_items?: MemoryEvidenceItem[];
  voice_ui?: {
    intent?: string;
    memory_phases?: string[];
    evidence_items?: MemoryEvidenceItem[];
    should_show_evidence_drawer?: boolean;
  };
  timing?: { asr_model_load_ms?: number | null; total_ms?: number };
};

const CALENDAR_DRAFT_TERMINAL_KEY = 'fx.slime.calendarDraftTerminal.v1';

function readTerminalCalendarDraftIds(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(CALENDAR_DRAFT_TERMINAL_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((x) => String(x).trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function markCalendarDraftTerminal(draftId: string | null | undefined): void {
  const id = String(draftId || '').trim();
  if (!id || typeof localStorage === 'undefined') return;
  try {
    const ids = readTerminalCalendarDraftIds();
    ids.add(id);
    localStorage.setItem(CALENDAR_DRAFT_TERMINAL_KEY, JSON.stringify([...ids].slice(-100)));
  } catch {
    /* ignore quota */
  }
}

function isCalendarDraftTerminal(draftId: string | null | undefined): boolean {
  const id = String(draftId || '').trim();
  return Boolean(id && readTerminalCalendarDraftIds().has(id));
}

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
  if (m === 'voice_stream_incomplete' || m.includes('voice_stream_incomplete')) {
    return 'That voice reply did not finish loading. Tap the mic and try again in a moment.';
  }
  if (m === 'voice_stream_failed' || m.includes('voice_stream_failed')) {
    return 'Something went wrong while streaming that reply. Please try again.';
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
  const candidates = [
    data.evidence_items,
    data.voice_ui?.evidence_items,
    data.tool_result?.evidence_items,
  ];
  const raw = candidates.find((x) => Array.isArray(x) && x.length) ?? [];
  return raw.filter((x) => x && typeof x.id === 'string') as MemoryEvidenceItem[];
}

function isVoiceRequestCancellable(s: VoiceAgentState): boolean {
  return (
    s === 'transcribing' ||
    s === 'searching_memory' ||
    s === 'synthesizing' ||
    s === 'thinking' ||
    s === 'preparing_voice' ||
    s === 'executing_tool' ||
    s === 'auto_stopping'
  );
}

/** Post-capture pipeline only — hide while idle/listening/recording before send. */
function isVoicePipelineActiveState(s: VoiceAgentState): boolean {
  return (
    s === 'auto_stopping' ||
    s === 'transcribing' ||
    s === 'searching_memory' ||
    s === 'synthesizing' ||
    s === 'thinking' ||
    s === 'preparing_voice' ||
    s === 'speaking' ||
    s === 'executing_tool'
  );
}

function voicePipelineDisplayState(
  voiceState: VoiceAgentState,
  buddyAudioPlaying: boolean,
): VoiceAgentState {
  if (buddyAudioPlaying && !isVoicePipelineActiveState(voiceState)) {
    return 'speaking';
  }
  return voiceState;
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

function isSlimeProfileVoiceIntent(text: string): boolean {
  const raw = text || '';
  const t = normalizeCalendarText(raw);
  return (
    /\b(?:change|rename|set|make|update)\s+(?:your|the)?\s*(?:slime\s+)?name\s+(?:to|into|as)\b/.test(t) ||
    /\b(?:your\s+name\s+is|i\s+will\s+call\s+you|i ll\s+call\s+you|call\s+you|rename\s+you|rename\s+yourself)\b/.test(t) ||
    /\b(?:call|address|refer\s+to)\s+me\s+(?:as\s+)?\b/.test(t) ||
    /(?:你就叫|你叫|你的名字|你名字|把你的名字|把你名字|给你取名|给你起名|叫我|称呼我|把我叫)/.test(raw)
  );
}

function calendarMutationKind(text: string): PendingCalendarMutation['kind'] | null {
  return calendarMutationKindFromTranscript(text, isSlimeProfileVoiceIntent(text));
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
  variant = 'buddy',
  slimeProfile,
  slimeType = 'generalized',
  onUpdateSlimeProfile,
  onAdvisorStateChange,
  onMemoryEvidenceItemsChange,
  threadId,
  onThreadId,
  onDecisionSuggestion,
  onProfileMemorySaved,
  onMemoryEvidenceRetrieved,
  onSpeechOutputChange,
  onCalendarStatusLine,
  onConversationUpdated,
  onThreadTitleUpdated,
  currentRoute,
  hideModelSelector = false,
  decisionModeActive = false,
  onToggleDecisionMode,
  decisionModeToggleDisabled = false,
  voiceGateDisabled = false,
  voiceGateMessage = null,
  className,
}: SlimeVoiceAgentProps) {
  const isCalendarVariant = variant === 'calendar';
  const navigate = useNavigate();
  const { showInsufficient, refresh: refreshCredits } = useSlimeCredits();
  const slimeModels = useSlimeModelCatalog();
  const defaultVoiceModelId = useMemo(() => {
    const little = slimeModels.models.find((m) => m.id === 'little')?.id;
    return little || slimeModels.defaultModel || '';
  }, [slimeModels.models, slimeModels.defaultModel]);
  const [voiceModelOptionId, setVoiceModelOptionId] = useState('');
  useEffect(() => {
    if (slimeModels.ready && defaultVoiceModelId && !voiceModelOptionId) {
      setVoiceModelOptionId(defaultVoiceModelId);
    }
  }, [slimeModels.ready, defaultVoiceModelId, voiceModelOptionId]);
  const { storageUserKey } = useExecutionStorageUserKey();
  const sendVoiceBlobRef = useRef<(blob: Blob | null) => Promise<void>>(async () => {});
  const { supported, recording, error, setError, startRecording, stopRecording, speechPhase } = useVoiceRecorder({
    autoStopOnSilence: true,
    silenceDetectionConfig: {
      silenceThreshold: 0.018,
      silenceDurationMs: 1100,
      minSpeechMs: 320,
      maxRecordingMs: 30000,
      maxInitialSilenceMs: 8000,
    },
    onAutoStop: (blob) => {
      setVoiceState('auto_stopping');
      void sendVoiceBlobRef.current(blob);
    },
  });
  const [voiceState, setVoiceState] = useState<VoiceAgentState>('idle');
  const [lastReplyText, setLastReplyText] = useState<string | null>(null);
  const [ttsHint, setTtsHint] = useState<string | null>(null);
  const [latencyHint, setLatencyHint] = useState<string | null>(null);
  const inFlightRequestRef = useRef(0);
  const voiceRequestAbortRef = useRef<AbortController | null>(null);
  const [streamDraftReply, setStreamDraftReply] = useState<string | null>(null);
  const slowHintTimerRef = useRef<number | null>(null);
  const verySlowHintTimerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const [buddyAudioPlaying, setBuddyAudioPlaying] = useState(false);
  const buddyAudioRef = useRef<HTMLAudioElement | null>(null);
  const buddyWebAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const buddyObjectUrlRef = useRef<string | null>(null);
  const buddyAudioAmpStopRef = useRef<(() => void) | null>(null);
  /** True while /api/slime/tts fetch or blob decode is in flight (buddyAudioRef not set yet). */
  const buddyTtsLoadPendingRef = useRef(false);
  /** Bumps when a new TTS request or recording session invalidates in-flight playback. */
  const ttsGenRef = useRef(0);
  const streamTtsActiveRef = useRef(false);
  const streamPlayChainRef = useRef<Promise<void>>(Promise.resolve());
  const streamPrefetchRef = useRef<Map<string, Promise<Blob | null>>>(new Map());
  const streamLedgerRef = useRef(new StreamTtsLedger());
  const streamBubbleDisplayRef = useRef('');
  const lastStreamedReplyRef = useRef('');
  /** Buddy voice stream received text deltas — defer TTS until the full reply is ready (single read). */
  const voiceStreamPendingRef = useRef(false);
  const speechUtteranceRef = useRef(0);
  /** Prevents stream/TTS races from replacing a full bubble with a shorter streamed prefix. */
  const lastBubbleTextRef = useRef('');
  /** voice-command-stream credit id — Buddy TTS chunks in the same turn reuse this (no per-sentence TTS debit). */
  const voiceTurnCreditIdRef = useRef<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    patch: Record<string, unknown>;
  } | null>(null);
  const [pendingCalendar, setPendingCalendar] = useState<ResolvedCalendar | null>(null);
  const [pendingCalendarMutation, setPendingCalendarMutation] = useState<PendingCalendarMutation | null>(null);
  const [pendingAgentDraftId, setPendingAgentDraftId] = useState<string | null>(null);
  useEffect(() => {
    onAdvisorStateChange?.(mapVoiceToAdvisor(voiceState));
  }, [voiceState, onAdvisorStateChange]);

  const clearSpeechOutput = useCallback(() => {
    onSpeechOutputChange?.(null);
  }, [onSpeechOutputChange]);

  const clearVoiceTurnBilling = useCallback(() => {
    voiceTurnCreditIdRef.current = null;
  }, []);

  const cancelVoiceRequest = useCallback(() => {
    voiceRequestAbortRef.current?.abort();
    voiceRequestAbortRef.current = null;
    clearVoiceTurnBilling();
    inFlightRequestRef.current += 1;
    if (slowHintTimerRef.current != null) {
      window.clearTimeout(slowHintTimerRef.current);
      slowHintTimerRef.current = null;
    }
    if (verySlowHintTimerRef.current != null) {
      window.clearTimeout(verySlowHintTimerRef.current);
      verySlowHintTimerRef.current = null;
    }
    setLatencyHint(null);
    setStreamDraftReply(null);
    setVoiceState('idle');
  }, [clearVoiceTurnBilling]);

  const showSpeechOutput = useCallback(
    (
      text: string,
      opts?: {
        speaking?: boolean;
        source?: SlimeSpeechOutput['source'];
        evidenceItems?: MemoryEvidenceItem[];
        utteranceId?: number;
      },
    ) => {
      const trimmed = text.trim();
      setLastReplyText(trimmed || null);
      if (isCalendarVariant) {
        onCalendarStatusLine?.(trimmed || null);
        return;
      }
      const prev = lastBubbleTextRef.current;
      if (prev && trimmed && trimmed.length < prev.length && prev.startsWith(trimmed)) {
        return;
      }
      if (trimmed) {
        lastBubbleTextRef.current = trimmed;
      } else {
        lastBubbleTextRef.current = '';
      }
      onSpeechOutputChange?.(
        trimmed
          ? {
              text: trimmed,
              speaking: opts?.speaking ?? false,
              source: opts?.source ?? 'assistant',
              evidenceItems: opts?.evidenceItems,
              utteranceId: opts?.utteranceId ?? speechUtteranceRef.current,
            }
          : null,
      );
    },
    [isCalendarVariant, onCalendarStatusLine, onSpeechOutputChange],
  );

  const releaseBuddyAudioPlayback = useCallback(() => {
    buddyAudioAmpStopRef.current?.();
    buddyAudioAmpStopRef.current = null;
    resetSlimeSpeakAmplitude();
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
    if (a) {
      a.onended = null;
      a.onerror = null;
      a.pause();
      a.removeAttribute('src');
    }
    if (u) URL.revokeObjectURL(u);
    setBuddyAudioPlaying(false);
  }, []);

  const resetStreamTtsState = useCallback(() => {
    streamTtsActiveRef.current = false;
    streamPlayChainRef.current = Promise.resolve();
    streamPrefetchRef.current.clear();
    streamLedgerRef.current.reset();
    streamBubbleDisplayRef.current = '';
    lastStreamedReplyRef.current = '';
    voiceStreamPendingRef.current = false;
  }, []);

  const cancelBuddyAudio = useCallback(() => {
    ttsGenRef.current += 1;
    buddyTtsLoadPendingRef.current = false;
    resetStreamTtsState();
    releaseBuddyAudioPlayback();
  }, [releaseBuddyAudioPlayback, resetStreamTtsState]);

  useEffect(() => () => cancelBuddyAudio(), [cancelBuddyAudio]);

  useEffect(
    () => () => {
      voiceRequestAbortRef.current?.abort();
    },
    [],
  );

  useEffect(
    () => () => {
      if (slowHintTimerRef.current != null) {
        window.clearTimeout(slowHintTimerRef.current);
        slowHintTimerRef.current = null;
      }
      if (verySlowHintTimerRef.current != null) {
        window.clearTimeout(verySlowHintTimerRef.current);
        verySlowHintTimerRef.current = null;
      }
    },
    [],
  );

  const fixedSlimeTtsVoice = ttsVoiceForSlimeType(slimeType);

  const fetchTtsBlob = useCallback(
    async (text: string, prefix: string, notify: boolean): Promise<Blob | null> => {
      const trimmed = text.trim();
      if (!trimmed) return null;
      const ttsCredit =
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${prefix}-${Date.now()}`;
      const ttsVoice = normalizeTtsVoiceName(fixedSlimeTtsVoice);
      const bundledTurn = voiceTurnCreditIdRef.current;
      const r = await apiFetch('/api/slime/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Credit-Request-Id': ttsCredit,
          ...(bundledTurn ? { 'X-Bundled-Voice-Turn': bundledTurn } : {}),
        },
        body: JSON.stringify({
          text: trimmed,
          ...(ttsVoice ? { voice: ttsVoice } : {}),
          ...(typeof slimeProfile.voice?.rate === 'number' ? { speed: slimeProfile.voice.rate } : {}),
          ...(voiceModelOptionId ? { model_option_id: voiceModelOptionId } : {}),
        }),
      });
      if (r.status === 402) {
        if (notify) {
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
        return null;
      }
      if (r.status === 503) {
        if (notify) setTtsHint('Voice needs OPENAI_API_KEY on the API (same as chat).');
        return null;
      }
      if (!r.ok) throw new Error(await r.text());
      return r.blob();
    },
    [fixedSlimeTtsVoice, showInsufficient, slimeProfile.voice, voiceModelOptionId],
  );

  const playTtsBlob = useCallback(
    async (
      blob: Blob,
      gen: number,
      spokenText: string,
      opts: RunTtsOptions | undefined,
      onComplete: () => void,
      displayText = spokenText,
    ): Promise<boolean> => {
      if (gen !== ttsGenRef.current) return false;

      return new Promise<boolean>((resolve) => {
        let started = false;
        let settled = false;
        const settle = (ok: boolean) => {
          if (settled) return;
          settled = true;
          resolve(ok);
        };

        const startOutput = () => {
          if (gen !== ttsGenRef.current || started) return;
          started = true;
          setVoiceState('speaking');
          if (!opts?.suppressBubble && displayText.trim()) {
            showSpeechOutput(displayText, {
              speaking: true,
              source: opts?.source,
              evidenceItems: opts?.evidenceItems,
            });
          }
          opts?.onStart?.();
        };

        const completeOutput = () => {
          if (gen === ttsGenRef.current && displayText.trim() && !opts?.suppressSpeakingEnd) {
            showSpeechOutput(displayText, {
              speaking: false,
              source: opts?.source,
              evidenceItems: opts?.evidenceItems,
            });
          }
          onComplete();
          settle(true);
        };

        const failOutput = () => {
          onComplete();
          settle(false);
        };

        buddyTtsLoadPendingRef.current = false;
        setBuddyAudioPlaying(true);

        const finishOutput = () => {
          if (gen !== ttsGenRef.current) {
            releaseBuddyAudioPlayback();
            settle(false);
            return;
          }
          releaseBuddyAudioPlayback();
          if (!opts?.sequenceHasMore && gen === ttsGenRef.current) {
            setVoiceState('idle');
          }
          completeOutput();
        };

        void (async () => {
          if (gen !== ttsGenRef.current) {
            settle(false);
            return;
          }
          // Stop any stray source before starting (stream queue runs one clip at a time).
          releaseBuddyAudioPlayback();

          const webOk = await playMp3BlobWithWebAudio(blob, {
            onStart: startOutput,
            onEnded: finishOutput,
            trackSource: (node) => {
              buddyWebAudioSourceRef.current = node;
            },
          });
          if (gen !== ttsGenRef.current) {
            settle(false);
            return;
          }
          if (webOk) return;

          const url = URL.createObjectURL(blob);
          buddyObjectUrlRef.current = url;
          const audio = new Audio();
          buddyAudioRef.current = audio;
          audio.setAttribute('playsinline', 'true');
          audio.preload = 'auto';
          audio.src = url;
          buddyAudioAmpStopRef.current?.();
          buddyAudioAmpStopRef.current = connectHtmlAudioAmplitudeAnalyzer(audio);
          audio.onended = () => {
            buddyAudioAmpStopRef.current?.();
            buddyAudioAmpStopRef.current = null;
            finishOutput();
          };
          audio.onerror = () => {
            if (opts?.sequenceHasMore) {
              releaseBuddyAudioPlayback();
            } else {
              cancelBuddyAudio();
              setVoiceState('idle');
            }
            setTtsHint('Could not play audio — check API / OPENAI_API_KEY, or try again.');
            opts?.onMayHaveBlocked?.();
            failOutput();
          };
          try {
            await audio.play();
            startOutput();
          } catch {
            cancelBuddyAudio();
            if (gen !== ttsGenRef.current) {
              settle(false);
              return;
            }
            setVoiceState('idle');
            setTtsHint('Could not play TTS audio — tap again after interacting with the page.');
            opts?.onMayHaveBlocked?.();
            failOutput();
          }
        })();
      });
    },
    [cancelBuddyAudio, releaseBuddyAudioPlayback, showSpeechOutput],
  );

  const runTts = useCallback(
    (text: string, opts?: RunTtsOptions) => {
      const trimmed = text.trim();
      const displayText = opts?.displayText || trimmed;
      const voiceOff = slimeProfile.voice?.enabled === false;
      const useTts = Boolean(trimmed) && (opts?.force === true || !voiceOff);
      const buddyUnifiedReveal = !isCalendarVariant;
      if (!useTts) {
        if (displayText) {
          showSpeechOutput(displayText, {
            speaking: false,
            source: opts?.source,
            evidenceItems: opts?.evidenceItems,
          });
        }
        setVoiceState('idle');
        opts?.onComplete?.();
        return;
      }

      if (!opts?.skipCancel) cancelBuddyAudio();
      const gen = ++ttsGenRef.current;
      if (!opts?.keepSpeakingState) {
        setVoiceState(buddyUnifiedReveal ? 'thinking' : 'preparing_voice');
      }
      buddyTtsLoadPendingRef.current = true;
      void (async () => {
        try {
          const blob = await fetchTtsBlob(trimmed, 'tts', true);
          if (!blob || gen !== ttsGenRef.current) {
            buddyTtsLoadPendingRef.current = false;
            if (gen === ttsGenRef.current) {
              if (displayText) {
                showSpeechOutput(displayText, {
                  speaking: false,
                  source: opts?.source,
                  evidenceItems: opts?.evidenceItems,
                });
              }
              setVoiceState('idle');
            }
            opts?.onComplete?.();
            return;
          }
          if (buddyUnifiedReveal && displayText.trim() && gen === ttsGenRef.current) {
            showSpeechOutput(displayText, {
              speaking: true,
              source: opts?.source,
              evidenceItems: opts?.evidenceItems,
            });
            setVoiceState('speaking');
          }
          await playTtsBlob(
            blob,
            gen,
            trimmed,
            { ...opts, suppressBubble: buddyUnifiedReveal },
            () => opts?.onComplete?.(),
            displayText,
          );
        } catch {
          setTtsHint('TTS voice was unavailable — check API / credits, then try again.');
          buddyTtsLoadPendingRef.current = false;
          if (gen !== ttsGenRef.current) return;
          if (displayText) {
            showSpeechOutput(displayText, {
              speaking: false,
              source: opts?.source,
              evidenceItems: opts?.evidenceItems,
            });
          }
          setVoiceState('idle');
          opts?.onComplete?.();
        }
      })();
    },
    [cancelBuddyAudio, fetchTtsBlob, isCalendarVariant, playTtsBlob, showSpeechOutput, slimeProfile.voice],
  );

  const playFinalVoiceText = useCallback(
    (text: string, opts?: RunTtsOptions) => {
      const normalized = normalizeSpeechText(text);
      if (!normalized) {
        opts?.onComplete?.();
        return;
      }
      const displayText = normalizeSpeechText(opts?.displayText || normalized);
      const buddyUnifiedReveal = !isCalendarVariant;
      const parts = groupSpeakableParts(splitSpeakableParts(normalized, 12), 360, 6);
      if (!parts.length) {
        opts?.onComplete?.();
        return;
      }

      cancelBuddyAudio();
      if (displayText.trim()) {
        showSpeechOutput(displayText, {
          speaking: true,
          source: opts?.source,
          evidenceItems: opts?.evidenceItems,
        });
      }
      if (buddyUnifiedReveal) {
        setVoiceState('speaking');
      }

      const finishAll = () => {
        buddyTtsLoadPendingRef.current = false;
        setBuddyAudioPlaying(false);
        setVoiceState('idle');
        if (displayText.trim()) {
          showSpeechOutput(displayText, {
            speaking: false,
            source: opts?.source,
            evidenceItems: opts?.evidenceItems,
          });
        }
        opts?.onComplete?.();
      };

      if (parts.length === 1) {
        runTts(parts[0], {
          ...opts,
          displayText,
          suppressBubble: buddyUnifiedReveal,
          keepSpeakingState: buddyUnifiedReveal,
        });
        return;
      }

      const gen = ++ttsGenRef.current;
      buddyTtsLoadPendingRef.current = true;
      const blobPromises = parts.map((part, i) => fetchTtsBlob(part, `seq-${i}`, i === 0));

      const playIndex = (index: number) => {
        void (async () => {
          if (gen !== ttsGenRef.current) return;
          if (index >= parts.length) {
            buddyTtsLoadPendingRef.current = false;
            finishAll();
            return;
          }
          const isLast = index + 1 >= parts.length;
          try {
            const blob = await blobPromises[index];
            if (gen !== ttsGenRef.current) return;
            if (!blob) {
              if (isLast) {
                buddyTtsLoadPendingRef.current = false;
                finishAll();
              } else {
                playIndex(index + 1);
              }
              return;
            }
            await playTtsBlob(
              blob,
              gen,
              parts[index],
              {
                ...opts,
                suppressBubble: true,
                suppressSpeakingEnd: !isLast,
                sequenceHasMore: !isLast,
                evidenceItems: isLast ? opts?.evidenceItems : undefined,
              },
              () => playIndex(index + 1),
              displayText,
            );
          } catch {
            if (gen !== ttsGenRef.current) return;
            buddyTtsLoadPendingRef.current = false;
            setTtsHint('TTS voice was unavailable — check API / credits, then try again.');
            finishAll();
          }
        })();
      };
      playIndex(0);
    },
    [cancelBuddyAudio, fetchTtsBlob, isCalendarVariant, playTtsBlob, runTts, showSpeechOutput],
  );

  const appendStreamPlaybackFinish = useCallback(
    (spokenFlushText: string, opts?: RunTtsOptions) => {
      const displayText = normalizeSpeechText(opts?.displayText || spokenFlushText);
      const gen = ttsGenRef.current;
      streamPlayChainRef.current = streamPlayChainRef.current.then(async () => {
        if (gen !== ttsGenRef.current) return;
        buddyTtsLoadPendingRef.current = false;
        setBuddyAudioPlaying(false);
        if (displayText.trim()) {
          showSpeechOutput(displayText, {
            speaking: false,
            source: opts?.source ?? 'assistant',
            evidenceItems: opts?.evidenceItems,
            utteranceId: speechUtteranceRef.current,
          });
        }
        if (gen === ttsGenRef.current) setVoiceState('idle');
        opts?.onComplete?.();
      });
    },
    [showSpeechOutput],
  );

  const runStreamDrainLoop = useCallback(
    async (gen: number, opts: RunTtsOptions | undefined) => {
      const buddyUnifiedReveal = !isCalendarVariant;
      const bubbleText = streamBubbleDisplayRef.current;
      const ledger = streamLedgerRef.current;

      while (ledger.hasMoreToPlay()) {
        if (gen !== ttsGenRef.current) return;

        const chunk = ledger.chunkAtPlayCursor();
        if (!chunk) {
          ledger.playCursor += 1;
          continue;
        }
        if (chunk.state === 'done' || chunk.state === 'failed') {
          ledger.playCursor += 1;
          continue;
        }

        const part = chunk.text;
        const sequenceHasMore = ledger.sequenceHasMore();
        const prefetchKey = ledger.prefetchKey(gen, chunk);

        let blob: Blob | null = null;
        const prefetched = streamPrefetchRef.current.get(prefetchKey);
        streamPrefetchRef.current.delete(prefetchKey);
        if (prefetched) {
          try {
            blob = await prefetched;
          } catch {
            blob = null;
          }
        }
        for (let attempt = 0; attempt < 3 && !blob; attempt += 1) {
          if (gen !== ttsGenRef.current) return;
          blob = await fetchTtsBlob(
            part,
            `stream-${gen}-${chunk.key}-a${attempt}`,
            ledger.playCursor === 0 && attempt === 0,
          );
        }

        if (!blob) {
          ledger.markFailed();
          continue;
        }

        if (ledger.playCursor === 0) {
          buddyTtsLoadPendingRef.current = true;
          setVoiceState(buddyUnifiedReveal ? 'speaking' : 'preparing_voice');
        }

        const playIdx = ledger.playCursor;
        ledger.markPlaying();
        try {
          const played = await playTtsBlob(
            blob,
            gen,
            part,
            {
              ...opts,
              suppressBubble: buddyUnifiedReveal || playIdx > 0,
              keepSpeakingState: buddyUnifiedReveal,
              suppressSpeakingEnd: true,
              sequenceHasMore,
              skipCancel: true,
            },
            () => undefined,
            bubbleText || part,
          );
          if (played) {
            ledger.markDone(part);
          } else {
            ledger.markFailed();
          }
        } catch {
          setTtsHint('TTS voice was unavailable — check API / credits, then try again.');
          ledger.markFailed();
        }
      }
    },
    [fetchTtsBlob, isCalendarVariant, playTtsBlob, slimeProfile.voice],
  );

  const pushStreamSpeakPart = useCallback(
    (part: string, displayText: string, opts: RunTtsOptions | undefined): boolean => {
      const ledger = streamLedgerRef.current;
      const idx = ledger.enqueue(part);
      if (idx === null) return false;

      const voiceOff = slimeProfile.voice?.enabled === false;
      const useTts = opts?.force === true || !voiceOff;
      if (!useTts) {
        const c = ledger.chunks[idx];
        if (c) c.state = 'failed';
        return false;
      }

      if (displayText.trim()) {
        streamBubbleDisplayRef.current = normalizeSpeechText(displayText);
      }
      const chunk = ledger.chunks[idx];
      if (!chunk) return false;
      const gen = ttsGenRef.current;
      const prefetchKey = ledger.prefetchKey(gen, chunk);
      if (!streamPrefetchRef.current.has(prefetchKey)) {
        const notifyCredits = idx === 0;
        streamPrefetchRef.current.set(prefetchKey, fetchTtsBlob(chunk.text, prefetchKey, notifyCredits));
      }
      return true;
    },
    [fetchTtsBlob, slimeProfile.voice],
  );

  const kickStreamDrain = useCallback(
    (gen: number, opts?: RunTtsOptions) => {
      streamPlayChainRef.current = streamPlayChainRef.current.then(async () => {
        if (gen !== ttsGenRef.current) return;
        await runStreamDrainLoop(gen, opts);
      });
    },
    [runStreamDrainLoop],
  );

  const feedStreamingVoiceTts = useCallback(
    (fullText: string, opts?: RunTtsOptions) => {
      const normalized = normalizeSpeechText(fullText);
      if (!normalized) return;
      const ledger = streamLedgerRef.current;
      const newParts = ledger.feedNewParts(normalized);
      streamTtsActiveRef.current = true;
      unlockSlimeAudioContext();
      streamBubbleDisplayRef.current = normalized;
      if (!isCalendarVariant) {
        showSpeechOutput(normalized, {
          speaking: true,
          source: opts?.source ?? 'assistant',
          utteranceId: speechUtteranceRef.current,
        });
      }
      if (!newParts.length) return;
      let enqueued = false;
      for (const part of newParts) {
        if (pushStreamSpeakPart(part, normalized, opts)) enqueued = true;
      }
      if (enqueued) kickStreamDrain(ttsGenRef.current, opts);
    },
    [isCalendarVariant, kickStreamDrain, pushStreamSpeakPart, showSpeechOutput],
  );

  const finishStreamVoicePlayback = useCallback(
    async (finalText: string, opts?: RunTtsOptions) => {
      const normalized = normalizeSpeechText(finalText);
      if (!streamTtsActiveRef.current) {
        opts?.onComplete?.();
        return;
      }
      const streamBase = normalized;
      const displayText = normalizeSpeechText(opts?.displayText || streamBase);
      streamBubbleDisplayRef.current = displayText;
      const ledger = streamLedgerRef.current;
      ledger.turnDone = true;

      const tailParts = ledger.remainingCanonParts(streamBase);
      let enqueuedTail = false;
      for (const part of tailParts) {
        if (pushStreamSpeakPart(part, displayText, opts)) enqueuedTail = true;
      }
      if (enqueuedTail) kickStreamDrain(ttsGenRef.current, opts);

      const gen = ttsGenRef.current;
      try {
        streamPlayChainRef.current = streamPlayChainRef.current.then(async () => {
          if (gen !== ttsGenRef.current) return;
          await runStreamDrainLoop(gen, opts);
          if (gen !== ttsGenRef.current) return;
          appendStreamPlaybackFinish(displayText, opts);
        });
        await streamPlayChainRef.current;
      } finally {
        resetStreamTtsState();
      }
    },
    [appendStreamPlaybackFinish, kickStreamDrain, pushStreamSpeakPart, resetStreamTtsState, runStreamDrainLoop],
  );

  const mergeCalendarEvent = useCallback(
    (event: Record<string, unknown>) => {
      if (!storageUserKey) return;
      mergeExecutionCalendarEvents(storageUserKey, [event]);
    },
    [storageUserKey],
  );

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
      dispatchExecutionCalendarLocalBump();
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
    unlockSlimeAudioContext();
    const actedDraftId = pendingAgentDraftId;
    try {
      if (actedDraftId) {
        const events = await confirmCalendarDraft(actedDraftId);
        for (const ev of events) {
          mergeCalendarEvent(ev);
        }
        markCalendarDraftTerminal(actedDraftId);
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
      markCalendarDraftTerminal(actedDraftId);
      setPendingAgentDraftId(null);
      setPendingCalendar(null);
      runTts('Done — I added it to your execution calendar.', {
        force: true,
        onMayHaveBlocked: () =>
          setTtsHint('No audio? Tap “Play reply” below after the message appears.'),
      });
    } catch (e) {
      markCalendarDraftTerminal(actedDraftId);
      setPendingAgentDraftId(null);
      setPendingCalendar(null);
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
    unlockSlimeAudioContext();
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

  const handleVoiceResponse = useCallback(
    async (data: VoiceResponse) => {
      if (data.thread_id) onThreadId?.(data.thread_id);
      const updatedTitle = typeof data.thread_title === 'string' ? data.thread_title.trim() : '';
      if (updatedTitle && data.thread_id) {
        onThreadTitleUpdated?.(updatedTitle, data.thread_id);
      }
      const assistant = (data.assistant_text || '').trim();
      const toSpeak = (data.spoken_text || data.assistant_text || '').trim();
      const fe = data.frontend_action;
      const convTurn = Boolean(data.tool_result && typeof data.tool_result === 'object' && data.tool_result.conversation_turn);
      const speakBody =
        convTurn && data.spoken_sequence && data.spoken_sequence.length > 0
          ? data.spoken_sequence.map((p) => p.trim()).filter(Boolean).join(' ')
          : '';
      const finalSpokenText = normalizeSpeechText(speakBody || toSpeak || assistant);

      const evidenceItems = readEvidenceItems(data);

      const ttsCommon: RunTtsOptions = {
        force: true,
        evidenceItems,
        onComplete: () => {
          clearVoiceTurnBilling();
          setBuddyAudioPlaying(false);
          setVoiceState('idle');
        },
        onMayHaveBlocked: () =>
          setTtsHint('No audio? Tap “Play reply” below — some browsers block auto-speak after recording.'),
      };

      const hasDecisionSuggestion =
        convTurn &&
        Boolean(data.decision_suggestion?.should_show) &&
        slimeSupportsDecisionMode(slimeType);

      if (hasDecisionSuggestion) {
        // Surface the bottom card only — keep assistant reply TTS uninterrupted.
        onDecisionSuggestion?.(data.decision_suggestion ?? null);
      }

      if (data.transcript && (await prepareCalendarMutation(data.transcript))) {
        void refreshCredits();
        return;
      }

      if (fe?.type === 'slime_profile_refresh') {
        void refetchSlimeProfileGlobal();
      }

      if (fe?.type === 'calendar_draft_confirm' && fe.payload && typeof fe.payload === 'object') {
        const pl = fe.payload as { resolved?: ResolvedCalendar; draft_id?: string };
        const resolved = pl.resolved;
        const draftId = typeof pl.draft_id === 'string' ? pl.draft_id.trim() : '';
        if (draftId && isCalendarDraftTerminal(draftId)) {
          setPendingAgentDraftId(null);
          setPendingCalendar(null);
          setPendingCalendarMutation(null);
          setVoiceState('idle');
          void refreshCredits();
          return;
        }
        if (draftId) {
          setPendingAgentDraftId(draftId);
        } else {
          setPendingAgentDraftId(null);
        }
        if (resolved?.start_iso && resolved?.end_iso) {
          cancelBuddyAudio();
          onCalendarStatusLine?.(`Ready to add: ${resolved.display_summary}. Tap Add below.`);
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
        cancelBuddyAudio();
        applySlimeVoiceFrontendAction(navigate, fe as SlimeVoiceFrontendAction, {
          wellbeing: slimeType === 'wellbeing',
        });
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

      if (fe?.type === 'navigate') {
        applySlimeVoiceFrontendAction(navigate, fe, { wellbeing: slimeType === 'wellbeing' });
      }

      if (!hasDecisionSuggestion) {
        onDecisionSuggestion?.(null);
      }
      if (finalSpokenText) {
        const streamCanon = normalizeSpeechText(lastStreamedReplyRef.current);
        const displayText = streamCanon
          ? resolveVoiceDisplayText(streamCanon, finalSpokenText)
          : finalSpokenText;
        const hadStreamReply = voiceStreamPendingRef.current || streamTtsActiveRef.current;
        if (hadStreamReply && streamCanon) {
          voiceStreamPendingRef.current = false;
          await finishStreamVoicePlayback(streamCanon, {
            ...ttsCommon,
            displayText,
            source: 'assistant',
          });
        } else if (hadStreamReply && !streamCanon) {
          voiceStreamPendingRef.current = false;
          await finishStreamVoicePlayback(finalSpokenText, {
            ...ttsCommon,
            displayText,
            source: 'assistant',
          });
        } else {
          playFinalVoiceText(finalSpokenText, {
            ...ttsCommon,
            displayText,
            source: 'assistant',
          });
        }
      } else if (assistant) {
        showSpeechOutput(assistant, {
          speaking: false,
          source: 'assistant',
          evidenceItems,
        });
      }

      void refreshCredits();
      const mus = data.memory_updates;
      const savedMemoryThisTurn = Boolean(mus?.length);
      if (savedMemoryThisTurn) {
        const toastMsg = formatProfileMemoryToast(mus!, data.memory_update_details);
        if (toastMsg) {
          onProfileMemorySaved?.({
            message: toastMsg,
            items: mus!,
            details: (data.memory_update_details || []).map((d) => ({
              action: d.action,
              id: (d as { id?: string }).id,
              text: d.text,
              category: d.category,
            })),
          });
        }
      }
      onMemoryEvidenceItemsChange?.(evidenceItems);
      // Retrieval toast replaces the save toast when both fire in one turn — prefer the save notice.
      if (evidenceItems.length > 0 && !savedMemoryThisTurn) {
        onMemoryEvidenceRetrieved?.(evidenceItems.length);
      }
      if (!finalSpokenText) {
        buddyTtsLoadPendingRef.current = false;
        setBuddyAudioPlaying(false);
        setVoiceState('idle');
      }
    },
    [
      refreshCredits,
      onThreadId,
      onProfileMemorySaved,
      onMemoryEvidenceRetrieved,
      onMemoryEvidenceItemsChange,
      prepareCalendarMutation,
      onDecisionSuggestion,
      cancelBuddyAudio,
      playFinalVoiceText,
      finishStreamVoicePlayback,
      showSpeechOutput,
      runTts,
      navigate,
      clearVoiceTurnBilling,
    ],
  );

  const sendVoiceBlob = useCallback(
    async (blob: Blob | null) => {
      unlockSlimeAudioContext();
      voiceRequestAbortRef.current?.abort();
      const abortController = new AbortController();
      voiceRequestAbortRef.current = abortController;
      setStreamDraftReply(null);
      setVoiceState('transcribing');
      setLatencyHint(null);
      const requestGen = ++inFlightRequestRef.current;
      if (!blob) {
        setVoiceState('idle');
        showSpeechOutput('No audio captured.', { source: 'error' });
        return;
      }
      const recordingMs =
        recordingStartedAtRef.current != null
          ? Math.max(0, Math.round(performance.now() - recordingStartedAtRef.current))
          : undefined;
      recordingStartedAtRef.current = null;
      const fd = new FormData();
      fd.append('audio', blob, 'voice.webm');
      if (currentRoute) fd.append('current_route', currentRoute);
      if (threadId) fd.append('thread_id', threadId);
      fd.append('slime_type', slimeType);
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
      if (typeof recordingMs === 'number' && Number.isFinite(recordingMs)) {
        fd.append('recording_ms', String(recordingMs));
      }
      if (decisionModeActive && slimeSupportsDecisionMode(slimeType)) {
        fd.append('manual_decision_mode', 'true');
      }
      speechUtteranceRef.current += 1;
      lastBubbleTextRef.current = '';
      cancelBuddyAudio();
      resetStreamTtsState();
      setVoiceState('thinking');
      if (slowHintTimerRef.current != null) window.clearTimeout(slowHintTimerRef.current);
      if (verySlowHintTimerRef.current != null) window.clearTimeout(verySlowHintTimerRef.current);
      slowHintTimerRef.current = null;
      verySlowHintTimerRef.current = null;
      try {
        const reqStart = performance.now();
        const vcCredit =
          typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `vc-${Date.now()}`;
        voiceTurnCreditIdRef.current = vcCredit;
        const res = await apiFetch('/api/slime/voice-command-stream', {
          method: 'POST',
          headers: { 'X-Credit-Request-Id': vcCredit },
          body: fd,
          signal: abortController.signal,
        });
        const uploadMs = Math.max(0, Math.round(performance.now() - reqStart));
        if (inFlightRequestRef.current === requestGen) {
          setLatencyHint(uploadMs > 1800 ? 'Processing voice command…' : null);
        }
        if (res.status === 402) {
          clearVoiceTurnBilling();
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
          if (slowHintTimerRef.current != null) window.clearTimeout(slowHintTimerRef.current);
          if (verySlowHintTimerRef.current != null) window.clearTimeout(verySlowHintTimerRef.current);
          setLatencyHint(null);
          return;
        }
        if (!res.ok) {
          const t = await res.text();
          throw new Error(httpErrorBodyToMessage(t, res.statusText));
        }
        if (!res.body) {
          throw new Error('voice_stream_unavailable');
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamedText = '';
        let streamError: string | null = null;
        let finalData: VoiceResponse | null = null;
        const onEvent = (ev: Record<string, unknown>) => {
          const type = String(ev.type || '');
          if (type === 'status') {
            const status = String(ev.status || '');
            if (status === 'transcribing') setVoiceState('transcribing');
            else if (status === 'searching_memory') setVoiceState('searching_memory');
            else if (status === 'thinking') setVoiceState('thinking');
          } else if (type === 'transcript_ready') {
            unlockSlimeAudioContext();
          } else if (type === 'text_delta') {
            const delta = String(ev.delta || '');
            if (!delta.trim()) return;
            streamedText = streamedText ? `${streamedText}${delta}` : delta;
            lastStreamedReplyRef.current = streamedText;
            const draft = normalizeSpeechText(streamedText);
            if (isCalendarVariant) {
              onCalendarStatusLine?.(draft);
              setStreamDraftReply(draft);
              feedStreamingVoiceTts(streamedText, { force: true, source: 'assistant' });
            } else {
              voiceStreamPendingRef.current = true;
              if (draft) {
                streamBubbleDisplayRef.current = draft;
                showSpeechOutput(draft, {
                  speaking: true,
                  source: 'assistant',
                  utteranceId: speechUtteranceRef.current,
                });
                setVoiceState((s) =>
                  s === 'speaking' || s === 'preparing_voice' ? s : 'preparing_voice',
                );
              }
              feedStreamingVoiceTts(streamedText, { force: true, source: 'assistant' });
            }
          } else if (type === 'error') {
            streamError = String(ev.message || 'voice_stream_failed');
          } else if (type === 'done') {
            if (Boolean(ev.stream_error)) {
              streamError = streamError || 'voice_stream_failed';
              return;
            }
            const body = ev.voice_response;
            if (body && typeof body === 'object') {
              finalData = body as VoiceResponse;
            }
          }
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = parseSseBlocks(buffer, onEvent);
        }
        if (buffer.trim()) {
          parseSseBlocks(`${buffer}\n\n`, onEvent);
        }
        if (streamError) {
          throw new Error(streamError);
        }
        if (!finalData) {
          throw new Error('voice_stream_incomplete');
        }
        if (slowHintTimerRef.current != null) window.clearTimeout(slowHintTimerRef.current);
        if (verySlowHintTimerRef.current != null) window.clearTimeout(verySlowHintTimerRef.current);
        setLatencyHint(null);
        setStreamDraftReply(null);
        await handleVoiceResponse(finalData);
        voiceRequestAbortRef.current = null;
        onConversationUpdated?.(finalData.thread_id);
      } catch (e) {
        if (slowHintTimerRef.current != null) window.clearTimeout(slowHintTimerRef.current);
        if (verySlowHintTimerRef.current != null) window.clearTimeout(verySlowHintTimerRef.current);
        setLatencyHint(null);
        setStreamDraftReply(null);
        voiceRequestAbortRef.current = null;
        if (e instanceof DOMException && e.name === 'AbortError') {
          clearVoiceTurnBilling();
          setVoiceState('idle');
          return;
        }
        if (e instanceof Error && e.name === 'AbortError') {
          clearVoiceTurnBilling();
          setVoiceState('idle');
          return;
        }
        clearVoiceTurnBilling();
        setVoiceState('error');
        showSpeechOutput(friendlySlimeVoiceError(apiFetchErrorMessage(e)), { source: 'error' });
      }
    },
    [
      currentRoute,
      threadId,
      slimeProfile,
      slimeType,
      showInsufficient,
      voiceModelOptionId,
      showSpeechOutput,
      handleVoiceResponse,
      feedStreamingVoiceTts,
      onConversationUpdated,
      onCalendarStatusLine,
      isCalendarVariant,
      unlockSlimeAudioContext,
      cancelBuddyAudio,
      resetStreamTtsState,
      decisionModeActive,
      clearVoiceTurnBilling,
    ],
  );

  useEffect(() => {
    sendVoiceBlobRef.current = sendVoiceBlob;
  }, [sendVoiceBlob]);

  const pushToTalk = useCallback(async () => {
    if (voiceGateDisabled && !recording) {
      if (voiceGateMessage) setError(voiceGateMessage);
      return;
    }
    setError(null);
    setTtsHint(null);
    setLatencyHint(null);
    if (recording) {
      unlockSlimeAudioContext();
      const blob = await stopRecording();
      await sendVoiceBlob(blob);
      return;
    }

    cancelVoiceRequest();
    cancelBuddyAudio();
    ttsGenRef.current += 1;
    setLastReplyText(null);
    clearSpeechOutput();
    setPendingConfirm(null);
    setPendingCalendar(null);
    setPendingCalendarMutation(null);
    onDecisionSuggestion?.(null);
    onMemoryEvidenceItemsChange?.([]);
    setVoiceState('listening');
    recordingStartedAtRef.current = performance.now();
    unlockSlimeAudioContext();
    const ok = await startRecording();
    if (!ok) setVoiceState('error');
  }, [
    recording,
    stopRecording,
    startRecording,
    sendVoiceBlob,
    cancelBuddyAudio,
    setError,
    clearSpeechOutput,
    onDecisionSuggestion,
    onMemoryEvidenceItemsChange,
    cancelVoiceRequest,
    voiceGateDisabled,
    voiceGateMessage,
  ]);

  const onConfirmPatch = useCallback(async () => {
    if (!pendingConfirm?.patch || !onUpdateSlimeProfile) {
      setPendingConfirm(null);
      setVoiceState('idle');
      return;
    }
    unlockSlimeAudioContext();
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

  const petName = getSlimeIdentity(slimeType).displayName;
  const slimeTheme = getSlimeIdentity(slimeType).theme;
  const isBuddyRoute = currentRoute?.startsWith('/buddy') ?? false;
  const showBuddyInlineControls = isBuddyRoute && !isCalendarVariant;

  /** Bottom-anchored lane; split z-index so SlimeCompanionStage can paint between panels and mic (see Buddy page). */
  const voiceLane = isCalendarVariant
    ? 'relative w-full'
    : isBuddyRoute
      ? 'fixed left-1/2 w-[min(100%,380px)] -translate-x-1/2'
      : 'absolute left-1/2 w-[min(100%,380px)] -translate-x-1/2';
  const voiceDockLane = isCalendarVariant
    ? 'relative w-full'
    : isBuddyRoute
      ? 'fixed left-1/2 w-[min(92vw,500px)] -translate-x-1/2'
      : 'absolute left-1/2 w-[min(92vw,500px)] -translate-x-1/2';
  const showVoiceDockMeta =
    !isCalendarVariant &&
    Boolean(lastReplyText && !recording && voiceState === 'idle');
  const showVoicePipelineBar =
    !isCalendarVariant &&
    (isVoicePipelineActiveState(voiceState) || buddyAudioPlaying);
  const pipelineUiState = voicePipelineDisplayState(voiceState, buddyAudioPlaying);
  const showVoiceCancel = !recording && isVoiceRequestCancellable(voiceState);
  const showBuddyReplayButton =
    showBuddyInlineControls && Boolean(lastReplyText) && !recording && voiceState === 'idle' && !streamDraftReply;
  const buddyDockPhaseLabel =
    showBuddyInlineControls && recording ? speechPhaseLabel(speechPhase, recording) : null;

  const voiceUi = (
    <>
      <div
        data-slime-avoid
        className={cn(
          voiceLane,
          isCalendarVariant
            ? 'z-[10] flex flex-col items-center gap-2 pointer-events-auto'
            : isBuddyRoute
            ? 'z-[118] flex flex-col items-center gap-2 pointer-events-auto'
            : 'z-[32] flex flex-col items-center gap-2 pointer-events-auto',
          !isCalendarVariant && !isBuddyRoute && 'bottom-[132px] sm:bottom-[136px]',
          className,
        )}
        style={
          !isCalendarVariant && isBuddyRoute ? { bottom: BUDDY_VOICE_HINTS_BOTTOM } : undefined
        }
      >
        {ttsHint ? <p className="max-w-xs text-center text-[11px] text-amber-900/90">{ttsHint}</p> : null}
        {latencyHint ? <p className="max-w-xs text-center text-[11px] text-violet-900/90">{latencyHint}</p> : null}
        {error ? <p className="max-w-xs text-center text-xs text-red-700">{error}</p> : null}

        {pendingConfirm ? (
          <div className="flex max-w-sm flex-col items-center gap-2 rounded-2xl border border-amber-200/85 bg-amber-50 px-3 py-2 shadow-md backdrop-blur-md">
            <p className="text-center text-sm text-amber-950">{pendingConfirm.title}</p>
            <div className="flex gap-2">
              <BuddyTooltip content="Apply the proposed profile or style update from this conversation.">
                <button
                  type="button"
                  className="rounded-full px-4 py-1.5 text-xs font-semibold text-white"
                  style={{ background: slimeTheme.primary, boxShadow: `0 8px 20px ${slimeTheme.glow}` }}
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
          className={cn(
            'pointer-events-auto z-[58] rounded-3xl border border-white/80 bg-white/90 p-3 text-left shadow-[0_18px_60px_rgba(79,70,229,0.18)] backdrop-blur-xl',
            isCalendarVariant
              ? 'relative mt-2 w-full'
              : 'fixed bottom-[max(5.7rem,calc(env(safe-area-inset-bottom,0px)+5rem))] right-4 w-[min(92vw,22rem)] sm:right-6',
          )}
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
                    className="rounded-full px-4 py-1.5 text-xs font-semibold text-white"
                    style={{ background: slimeTheme.primary, boxShadow: `0 8px 20px ${slimeTheme.glow}` }}
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
                      markCalendarDraftTerminal(pendingAgentDraftId);
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
                      pendingCalendarMutation.kind === 'delete' ? 'bg-red-500 hover:bg-red-600' : '',
                    )}
                    style={
                      pendingCalendarMutation.kind === 'delete'
                        ? undefined
                        : { background: slimeTheme.primary, boxShadow: `0 8px 20px ${slimeTheme.glow}` }
                    }
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
        data-testid={isBuddyRoute ? 'buddy-voice-dock' : undefined}
        className={cn(
          voiceDockLane,
          isCalendarVariant
            ? 'mt-2 z-[52] pointer-events-auto'
            : isBuddyRoute
              ? 'z-[120] pointer-events-auto'
              : 'bottom-2 z-[52] pointer-events-auto sm:bottom-3',
        )}
        style={
          !isCalendarVariant && isBuddyRoute ? { bottom: BUDDY_VOICE_DOCK_BOTTOM } : undefined
        }
      >
        <div
          className={cn(
            'relative mx-auto flex w-full flex-col items-center overflow-visible transition',
            showBuddyInlineControls
              ? 'gap-3 border-transparent bg-transparent p-0 shadow-none backdrop-blur-0'
              : 'gap-2 rounded-[26px] border border-white/55 bg-white/38 px-3 py-3 shadow-[0_18px_52px_rgba(124,58,237,0.12)] backdrop-blur-xl',
            !showVoiceDockMeta && !showVoicePipelineBar && !showBuddyInlineControls &&
              'w-auto rounded-full border-transparent bg-transparent px-2 py-2 shadow-none backdrop-blur-0',
            !isCalendarVariant &&
              decisionModeActive &&
              !showBuddyInlineControls &&
              'border-sky-200/70 bg-sky-50/20',
          )}
        >
          {!showBuddyInlineControls && showVoiceDockMeta ? (
            <div className="relative z-10 flex w-full items-center justify-center gap-2">
              {isCalendarVariant && streamDraftReply && !recording ? (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="min-w-0 max-w-[min(66vw,360px)] rounded-full border border-fuchsia-200/80 bg-fuchsia-50/90 px-3 py-1.5 text-center text-[11px] leading-snug text-fuchsia-950 shadow-sm backdrop-blur-md"
                >
                  <span className="font-semibold text-fuchsia-800">Replying</span>
                  <span className="mx-1 text-fuchsia-300">•</span>
                  <span className="line-clamp-2 align-bottom">{streamDraftReply}</span>
                </motion.div>
              ) : null}

              {lastReplyText && !recording && voiceState === 'idle' && !streamDraftReply ? (
                <BuddyTooltip content="Play the assistant's last reply with the saved TTS voice.">
                  <button
                    type="button"
                    className={cn(
                      'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-white/80 px-2.5 text-[11px] font-semibold shadow-sm transition',
                      buddyAudioPlaying && 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800',
                    )}
                    style={
                      buddyAudioPlaying
                        ? undefined
                        : { borderColor: `${slimeTheme.border}cc`, color: slimeTheme.heading }
                    }
                    onClick={() => {
                      setTtsHint(null);
                      unlockSlimeAudioContext();
                      runTts(lastReplyText, { force: true });
                    }}
                  >
                    <RotateCcw className={cn('h-3.5 w-3.5', buddyAudioPlaying && 'animate-spin')} aria-hidden />
                    <span className="hidden sm:inline">{buddyAudioPlaying ? 'Replaying' : 'Replay'}</span>
                  </button>
                </BuddyTooltip>
              ) : null}
            </div>
          ) : null}

          {showBuddyInlineControls ? (
            <div className="relative z-10 w-full max-w-[min(96vw,22rem)]">
              <BuddyVoiceDockBar
                theme={slimeTheme}
                slimeType={slimeType}
                petName={petName}
                supported={supported}
                recording={recording}
                voiceGateDisabled={voiceGateDisabled}
                voiceGateMessage={voiceGateMessage}
                onPushToTalk={() => void pushToTalk()}
                showDecision={Boolean(onToggleDecisionMode && slimeSupportsDecisionMode(slimeType))}
                decisionModeActive={decisionModeActive}
                decisionModeToggleDisabled={decisionModeToggleDisabled}
                onToggleDecisionMode={onToggleDecisionMode}
                showVoiceCancel={showVoiceCancel}
                onCancelVoice={() => cancelVoiceRequest()}
                showReplay={showBuddyReplayButton}
                buddyAudioPlaying={buddyAudioPlaying}
                onReplay={() => {
                  setTtsHint(null);
                  unlockSlimeAudioContext();
                  runTts(lastReplyText ?? '', { force: true });
                }}
                hideModelSelector={hideModelSelector}
                voiceModelOptionId={voiceModelOptionId || defaultVoiceModelId}
                defaultVoiceModelId={defaultVoiceModelId}
                onVoiceModelChange={setVoiceModelOptionId}
                models={slimeModels.models}
                selectorEnabled={slimeModels.selectorEnabled}
                phaseLabel={buddyDockPhaseLabel}
              />
            </div>
          ) : (
            <div className="relative z-10 h-14 w-full max-w-[min(96vw,760px)]">
              <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
                {recording ? (
                  <motion.span
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{ backgroundColor: `${slimeTheme.accent}40` }}
                    animate={{ scale: [1, 1.35, 1], opacity: [0.5, 0.15, 0.5] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                ) : null}
                <BuddyTooltip
                  side="top"
                  content={
                    voiceGateDisabled && voiceGateMessage
                      ? voiceGateMessage
                      : supported
                        ? `Tap to start or stop recording and send to ${petName}. Works like push-to-talk.`
                        : 'Voice input is not available in this browser.'
                  }
                >
                  <span className="inline-flex rounded-full">
                    <button
                      type="button"
                      disabled={!supported || (voiceGateDisabled && !recording)}
                      onClick={() => void pushToTalk()}
                      aria-label={recording ? 'Stop recording' : `Talk to ${petName}`}
                      className={cn(
                        'relative flex h-14 w-14 items-center justify-center rounded-full border-2',
                        SLIME_CTA_BTN_CLASS,
                        'hover:scale-[1.03] disabled:cursor-not-allowed',
                        recording && 'ring-4 ring-cyan-300/80',
                      )}
                      style={slimeCtaButtonStyle(slimeTheme)}
                    >
                      {recording ? <Square className="h-6 w-6 fill-current" aria-hidden /> : <Mic className="h-6 w-6" aria-hidden />}
                    </button>
                  </span>
                </BuddyTooltip>
              </div>
            </div>
          )}

          {!showBuddyInlineControls &&
          !isCalendarVariant &&
          onToggleDecisionMode &&
          slimeSupportsDecisionMode(slimeType) ? (
            <motion.div className="relative z-10 -mb-1 flex w-full items-center justify-center">
              <DecisionModeToggle
                active={decisionModeActive}
                disabled={decisionModeToggleDisabled}
                onToggle={onToggleDecisionMode}
                testId="slime-decision-mode-toggle"
                className="-translate-y-1 bg-white/90"
                slimeType={slimeType}
              />
            </motion.div>
          ) : null}

          {!showBuddyInlineControls && recording && speechPhaseLabel(speechPhase, recording) ? (
            <p className="relative z-10 text-center text-xs font-medium text-cyan-900/90">{speechPhaseLabel(speechPhase, recording)}</p>
          ) : null}
          {!showBuddyInlineControls && showVoiceCancel ? (
            <BuddyTooltip content="Stop this request and return to idle.">
              <button
                type="button"
                onClick={() => cancelVoiceRequest()}
                className="relative z-10 rounded-full border border-red-200/90 bg-red-50/95 px-3 py-1 text-[11px] font-semibold text-red-800 shadow-sm transition hover:bg-red-100"
              >
                Stop
              </button>
            </BuddyTooltip>
          ) : null}
          {showVoicePipelineBar ? (
            <motion.div
              className="relative z-10 w-full overflow-hidden rounded-full border border-white/55 bg-white/32 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
              aria-label={statusLabel(pipelineUiState) || 'Voice assistant processing'}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.2 }}
            >
              <>
                <motion.div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/45 via-violet-100/30 to-cyan-100/25" />
                <motion.div
                  className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/75 to-transparent blur-sm"
                  animate={{ x: ['0%', '420%'] }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                />
                <motion.div className="relative mx-4 mb-1.5 mt-1 h-1 rounded-full bg-slate-200/70">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-300 via-cyan-300 to-violet-500 shadow-[0_0_16px_rgba(139,92,246,0.45)]"
                    initial={false}
                    animate={{ width: `${voiceStatusProgress(pipelineUiState)}%` }}
                    transition={{ type: 'spring', stiffness: 150, damping: 24 }}
                  />
                </motion.div>
              </>
              <div className="relative grid grid-cols-5 gap-1">
                {voiceStatusSteps(pipelineUiState).map((step) => (
                  <div key={step.key} className="flex min-w-0 flex-col items-center gap-1">
                    <motion.span
                      className={cn(
                        'relative h-2.5 w-2.5 rounded-full border transition',
                        step.active && 'border-white shadow-[0_0_18px_rgba(124,58,237,0.75)]',
                        step.done && 'border-white bg-emerald-300 shadow-[0_0_14px_rgba(45,212,191,0.55)]',
                        !step.active && !step.done && 'border-slate-200 bg-white/80',
                      )}
                      style={step.active ? { backgroundColor: slimeTheme.primary } : undefined}
                      animate={step.active ? { scale: [1, 1.3, 1], opacity: [0.9, 1, 0.9] } : { scale: 1, opacity: 1 }}
                      transition={step.active ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
                    >
                      {step.active ? <span className="absolute inset-[-5px] rounded-full border" style={{ borderColor: `${slimeTheme.accent}80` }} /> : null}
                    </motion.span>
                    <span
                      className={cn(
                        'max-w-full truncate text-[9px] font-semibold uppercase tracking-[0.12em] transition',
                        step.active && 'text-violet-900',
                        step.done && 'text-emerald-700',
                        !step.active && !step.done && 'text-slate-400',
                      )}
                    >
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : null}
        </div>
      </div>

      {!hideModelSelector && !showBuddyInlineControls ? (
        <div
          data-slime-avoid
          className="pointer-events-auto fixed right-3 bottom-[max(5.75rem,calc(env(safe-area-inset-bottom,0px)+4.75rem))] z-[52] w-[min(82vw,12rem)] sm:right-5"
        >
          <div className="rounded-lg border border-white/70 bg-white/85 px-2 py-1 shadow-sm backdrop-blur-sm">
            <ModelSelector
              feature="slime_voice"
              selectedModelId={voiceModelOptionId || defaultVoiceModelId}
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

    </>
  );

  return voiceUi;
}
