import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type SilenceDetectionConfig = {
  enabled: boolean;
  silenceThreshold: number;
  silenceDurationMs: number;
  minSpeechMs: number;
  maxRecordingMs: number;
  maxInitialSilenceMs: number;
};

export type VoiceRecorderSpeechPhase = 'idle' | 'waiting_speech' | 'hearing_speech' | 'trailing_silence';

export type UseVoiceRecorderOptions = {
  autoStopOnSilence?: boolean;
  silenceDetectionConfig?: Partial<Omit<SilenceDetectionConfig, 'enabled'>>;
  /** Fired after `stopRecording` completes (auto-silence or max duration). */
  onAutoStop?: (blob: Blob | null) => void;
};

const defaultSilence: SilenceDetectionConfig = {
  enabled: false,
  silenceThreshold: 0.018,
  silenceDurationMs: 1200,
  minSpeechMs: 320,
  maxRecordingMs: 28000,
  maxInitialSilenceMs: 8000,
};

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'audio/webm';
}

function rmsFromAnalyser(analyser: AnalyserNode): number {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    s += v * v;
  }
  return Math.sqrt(s / buf.length);
}

export function useVoiceRecorder(options?: UseVoiceRecorderOptions) {
  const optsRef = useRef(options);
  optsRef.current = options;

  const silenceMerged = useMemo((): SilenceDetectionConfig => {
    const c = options?.silenceDetectionConfig ?? {};
    return {
      ...defaultSilence,
      ...c,
      enabled: Boolean(options?.autoStopOnSilence),
    };
  }, [options?.autoStopOnSilence, options?.silenceDetectionConfig]);

  const [supported, setSupported] = useState(() => typeof window !== 'undefined' && !!window.MediaRecorder);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speechPhase, setSpeechPhase] = useState<VoiceRecorderSpeechPhase>('idle');
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const speechDetectRef = useRef({
    loudSince: null as number | null,
    speechStartedAt: null as number | null,
    lastQuietSince: null as number | null,
    recordStartedAt: 0,
  });
  const autoStoppingRef = useRef(false);

  const clearMonitor = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current = null;
    if (audioCtxRef.current) {
      try {
        void audioCtxRef.current.close();
      } catch {
        /* ignore */
      }
      audioCtxRef.current = null;
    }
    speechDetectRef.current = {
      loudSince: null,
      speechStartedAt: null,
      lastQuietSince: null,
      recordStartedAt: 0,
    };
  }, []);

  useEffect(() => () => clearMonitor(), [clearMonitor]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    clearMonitor();
    setSpeechPhase('idle');
    const rec = mediaRef.current;
    if (!rec || rec.state === 'inactive') {
      setRecording(false);
      return null;
    }
    return new Promise((resolve) => {
      rec.addEventListener(
        'stop',
        () => {
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          mediaRef.current = null;
          setRecording(false);
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          chunksRef.current = [];
          resolve(blob.size > 0 ? blob : null);
        },
        { once: true },
      );
      rec.stop();
    });
  }, [clearMonitor]);

  const startRecording = useCallback(async (): Promise<boolean> => {
    setError(null);
    autoStoppingRef.current = false;
    clearMonitor();
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setSupported(false);
      setError('Recording is not supported in this environment.');
      return false;
    }
    if (!window.MediaRecorder) {
      setSupported(false);
      setError('MediaRecorder is not supported in this browser.');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMimeType();
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRef.current = rec;
      rec.start();
      setRecording(true);
      const cfg = { ...defaultSilence, ...(optsRef.current?.silenceDetectionConfig ?? {}), enabled: Boolean(optsRef.current?.autoStopOnSilence) };
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      speechDetectRef.current = {
        loudSince: null,
        speechStartedAt: null,
        lastQuietSince: null,
        recordStartedAt: t0,
      };

      if (cfg.enabled && typeof AudioContext !== 'undefined') {
        try {
          const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AC) {
            const ctx = new AC();
            audioCtxRef.current = ctx;
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.65;
            src.connect(analyser);
            analyserRef.current = analyser;
            setSpeechPhase('waiting_speech');
            void ctx.resume();

            const tick = () => {
              const an = analyserRef.current;
              const media = mediaRef.current;
              if (!an || !media || media.state === 'inactive') {
                rafRef.current = null;
                return;
              }
              const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
              const sd = speechDetectRef.current;
              const rms = rmsFromAnalyser(an);
              const thr = cfg.silenceThreshold;

              if (rms >= thr) {
                sd.lastQuietSince = null;
                if (sd.loudSince == null) sd.loudSince = now;
                if (sd.speechStartedAt == null && sd.loudSince != null && now - sd.loudSince >= cfg.minSpeechMs) {
                  sd.speechStartedAt = now;
                  setSpeechPhase('hearing_speech');
                } else if (sd.speechStartedAt != null) {
                  setSpeechPhase('hearing_speech');
                }
              } else {
                sd.loudSince = null;
                if (sd.speechStartedAt != null) {
                  if (sd.lastQuietSince == null) sd.lastQuietSince = now;
                  setSpeechPhase('trailing_silence');
                  if (now - (sd.lastQuietSince ?? now) >= cfg.silenceDurationMs && !autoStoppingRef.current) {
                    autoStoppingRef.current = true;
                    rafRef.current = null;
                    void stopRecording().then((blob) => optsRef.current?.onAutoStop?.(blob));
                    return;
                  }
                }
              }

              if (now - sd.recordStartedAt >= cfg.maxRecordingMs && !autoStoppingRef.current) {
                autoStoppingRef.current = true;
                rafRef.current = null;
                void stopRecording().then((blob) => optsRef.current?.onAutoStop?.(blob));
                return;
              }

              rafRef.current = requestAnimationFrame(tick);
            };
            rafRef.current = requestAnimationFrame(tick);
          } else {
            setSpeechPhase('hearing_speech');
          }
        } catch {
          setSpeechPhase('hearing_speech');
        }
      } else {
        setSpeechPhase('hearing_speech');
      }
      return true;
    } catch {
      setError('Microphone permission denied or unavailable.');
      return false;
    }
  }, [clearMonitor, stopRecording]);

  return {
    supported,
    recording,
    error,
    setError,
    startRecording,
    stopRecording,
    speechPhase,
    silenceConfig: silenceMerged,
  };
}
