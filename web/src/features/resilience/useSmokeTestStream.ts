import { useCallback, useRef, useState } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { parseSseBlocks } from '../../utils/parseSse';
import type { SmokeEventLogEntry, SmokePhase, SmokeRun } from './smokeTestTypes';

const STAGE_ORDER = [
  'enhance',
  'perceive',
  'retrieve',
  'infer',
  'simulate',
  'evaluate',
  'finalize',
];

export function useSmokeTestStream() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SmokeRun | null>(null);
  const [phases, setPhases] = useState<SmokePhase[]>([]);
  const [liveLog, setLiveLog] = useState<SmokeEventLogEntry[]>([]);
  const [activeStages, setActiveStages] = useState<Set<string>>(new Set());
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set());
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setBusy(false);
    setError(null);
    setResult(null);
    setPhases([]);
    setLiveLog([]);
    setActiveStages(new Set());
    setCompletedStages(new Set());
    setCurrentStage(null);
  }, []);

  const run = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setBusy(true);
    setError(null);
    setResult(null);
    setPhases([]);
    setLiveLog([]);
    setActiveStages(new Set());
    setCompletedStages(new Set());
    setCurrentStage(null);

    try {
      const res = await apiFetch('/api/resilience/smoke-run/stream', {
        method: 'POST',
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      if (!res.ok) throw new Error(await res.text());
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const onEvent = (ev: Record<string, unknown>) => {
        const type = String(ev.type || '');
        if (type === 'phase') {
          const phase: SmokePhase = {
            id: String(ev.id || ''),
            label: String(ev.label || ''),
            status: String(ev.status || ''),
            detail: ev.detail != null ? String(ev.detail) : undefined,
          };
          setPhases((prev) => {
            const idx = prev.findIndex((p) => p.id === phase.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], ...phase };
              return next;
            }
            return [...prev, phase];
          });
          return;
        }

        if (type === 'pipeline') {
          const stage = ev.stage != null ? String(ev.stage) : '';
          const entry: SmokeEventLogEntry = {
            t_ms: typeof ev.t_ms === 'number' ? ev.t_ms : undefined,
            type: ev.event != null ? String(ev.event) : undefined,
            stage: stage || undefined,
            summary: ev.summary != null ? String(ev.summary) : undefined,
          };
          setLiveLog((prev) => [...prev.slice(-80), entry]);

          if (ev.event === 'stage' && stage) {
            setCurrentStage(stage);
            setActiveStages(new Set([stage]));
            setCompletedStages((prev) => {
              const idx = STAGE_ORDER.indexOf(stage);
              if (idx <= 0) return prev;
              const copy = new Set(prev);
              for (let i = 0; i < idx; i += 1) copy.add(STAGE_ORDER[i]);
              return copy;
            });
          }
          if (ev.event === 'complete') {
            setCompletedStages(new Set(STAGE_ORDER));
            setActiveStages(new Set());
            setCurrentStage('finalize');
          }
          return;
        }

        if (type === 'result' && ev.payload && typeof ev.payload === 'object') {
          const payload = ev.payload as SmokeRun;
          setResult(payload);
          if (payload.pipeline_stages_seen) {
            setCompletedStages(new Set(payload.pipeline_stages_seen));
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseBlocks(buffer, onEvent);
      }
      buffer += decoder.decode();
      parseSseBlocks(`${buffer}\n\n`, onEvent);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Smoke stream failed');
    } finally {
      setBusy(false);
      setActiveStages(new Set());
    }
  }, []);

  return {
    busy,
    error,
    result,
    phases,
    liveLog,
    activeStages,
    completedStages,
    currentStage,
    run,
    reset,
    stageOrder: STAGE_ORDER,
  };
}
