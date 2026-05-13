import { useCallback, useEffect, useState } from 'react';
import { unlockSlimeAudioContext } from '../../utils/slimeAudioContext';

export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

function resumeAudioContextFromGesture(): void {
  unlockSlimeAudioContext();
}

export type PrimeSpeechOptions = { skipUtterance?: boolean };

/**
 * Call synchronously from a click/touch handler (e.g. stop recording) so some engines
 * keep speech unlocked before async work finishes.
 */
export function primeSpeechSynthesisFromGesture(options?: PrimeSpeechOptions): void {
  if (!speechSynthesisSupported()) return;
  resumeAudioContextFromGesture();
  try {
    void window.speechSynthesis.getVoices();
    window.speechSynthesis.resume();
    if (options?.skipUtterance) return;
    // WebKit / iOS often need an utterance started during the gesture; real speech runs after fetch.
    const prime = new SpeechSynthesisUtterance('\u00a0');
    prime.volume = 0.001;
    prime.rate = 10;
    window.speechSynthesis.speak(prime);
  } catch {
    /* ignore */
  }
}

type SpeakOptions = {
  rate?: number;
  pitch?: number;
  preferredVoiceName?: string;
  lang?: string;
  /** Fired when the browser starts speaking the utterance. */
  onUtteranceStart?: () => void;
  /** Fired ~600ms after speak() if nothing entered the queue (common when TTS runs after async work without a fresh gesture). */
  onMayHaveBlocked?: () => void;
  /** After utterance ends, errors, or speak() throws (e.g. Slime Buddy voiceState). */
  onUtteranceEnd?: () => void;
};

/**
 * BCP 47 tag for the utterance. If this doesn't match the actual script, engines often use a
 * system-local voice (e.g. zh-CN) to read English — heavy accent / wrong phonemes.
 */
/** Exported for unit tests — picks en-US vs zh so TTS voice matches script. */
export function inferUtteranceLang(text: string): string {
  const sample = text.slice(0, 280);
  let han = 0;
  let latin = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c >= 0x4e00 && c <= 0x9fff) han++;
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) latin++;
  }
  if (han >= 3 && han >= latin * 0.35) {
    if (typeof navigator !== 'undefined') {
      const nav = (navigator.language || '').toLowerCase();
      if (nav.startsWith('zh')) return navigator.language;
    }
    return 'zh-CN';
  }
  return 'en-US';
}

function voiceMatchesUtteranceLang(voice: SpeechSynthesisVoice, utterLang: string): boolean {
  const u = utterLang.toLowerCase();
  const vl = (voice.lang || '').toLowerCase();
  if (!vl) return true;
  if (u.startsWith('en')) return vl.startsWith('en');
  if (u.startsWith('zh')) return vl.startsWith('zh');
  return vl.startsWith(u.slice(0, 2)) || u.startsWith(vl.slice(0, 2));
}

function applyVoiceOptions(u: SpeechSynthesisUtterance, options: SpeakOptions | undefined, utterLang: string) {
  if (typeof options?.rate === 'number' && Number.isFinite(options.rate)) {
    u.rate = Math.min(2, Math.max(0.5, options.rate));
  }
  if (typeof options?.pitch === 'number' && Number.isFinite(options.pitch)) {
    u.pitch = Math.min(2, Math.max(0.5, options.pitch));
  }
  if (options?.preferredVoiceName) {
    const pick = () => window.speechSynthesis.getVoices().find((v) => v.name === options.preferredVoiceName);
    let match = pick();
    if (!match) {
      void window.speechSynthesis.getVoices();
      match = pick();
    }
    if (match && voiceMatchesUtteranceLang(match, utterLang)) {
      u.voice = match;
    }
  }
}

export function useSpeechSynthesis() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const supported = speechSynthesisSupported();

  const cancel = useCallback(() => {
    if (!speechSynthesisSupported()) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  const speak = useCallback((text: string, options?: SpeakOptions) => {
    if (!speechSynthesisSupported()) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const run = () => {
      window.speechSynthesis.cancel();
      try {
        void window.speechSynthesis.getVoices();
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      } catch {
        /* ignore */
      }
      const utterLang = options?.lang?.trim() || inferUtteranceLang(trimmed);
      const u = new SpeechSynthesisUtterance(trimmed);
      applyVoiceOptions(u, options, utterLang);
      u.volume = 1;
      u.lang = utterLang;

      let blockTimer: number | null = null;
      const clearBlockTimer = () => {
        if (blockTimer != null) {
          window.clearTimeout(blockTimer);
          blockTimer = null;
        }
      };
      const scheduleBlockCheck = () => {
        if (!options?.onMayHaveBlocked) return;
        clearBlockTimer();
        blockTimer = window.setTimeout(() => {
          blockTimer = null;
          try {
            const syn = window.speechSynthesis;
            if (!syn.speaking && !syn.pending) {
              options.onMayHaveBlocked?.();
            }
          } catch {
            options.onMayHaveBlocked?.();
          }
        }, 620);
      };

      u.onstart = () => {
        clearBlockTimer();
        setIsSpeaking(true);
        setIsPaused(false);
        options?.onUtteranceStart?.();
      };
      u.onend = () => {
        clearBlockTimer();
        setIsSpeaking(false);
        setIsPaused(false);
        options?.onUtteranceEnd?.();
      };
      u.onerror = (ev) => {
        clearBlockTimer();
        const code = ev.error;
        if (code && code !== 'canceled' && code !== 'interrupted') {
          console.warn('[TTS] utterance error:', code, trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed);
        }
        setIsSpeaking(false);
        setIsPaused(false);
        options?.onUtteranceEnd?.();
      };
      try {
        // Must follow cancel() in the same synchronous turn as the click that called speak().
        // If we wait for voiceschanged / setTimeout, the browser treats speak() as non-gestured and stays silent.
        window.speechSynthesis.speak(u);
        scheduleBlockCheck();
      } catch (e) {
        clearBlockTimer();
        console.warn('[TTS] speak() threw:', e);
        setIsSpeaking(false);
        options?.onUtteranceEnd?.();
      }
    };

    // Populate voice list (async on many engines); default synthesis still works with an empty list.
    void window.speechSynthesis.getVoices();
    run();
  }, []);

  const pause = useCallback(() => {
    if (!speechSynthesisSupported() || !isSpeaking) return;
    try {
      window.speechSynthesis.pause();
      setIsPaused(true);
    } catch {
      /* some engines noop */
    }
  }, [isSpeaking]);

  const resume = useCallback(() => {
    if (!speechSynthesisSupported()) return;
    try {
      window.speechSynthesis.resume();
      setIsPaused(false);
    } catch {
      /* some engines noop */
    }
  }, []);

  return { supported, isSpeaking, isPaused, speak, pause, resume, cancel };
}
