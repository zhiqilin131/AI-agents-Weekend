import { useCallback, useMemo, useRef, useState } from 'react';
import { useSlimeCredits } from '../app/components/credits/SlimeCreditsContext';
import { apiFetch } from '../utils/apiFetch';
import { mergeStreamingPartial } from '../utils/mergeStreamingTrace';
import { parseSseBlocks } from '../utils/parseSse';

type StreamStatus = 'idle' | 'streaming' | 'done' | 'error';

export type DecisionReportStreamResult = {
  trace: Record<string, unknown> | null;
  error: string | null;
};

export function useDecisionReportStream() {
  const { showInsufficient } = useSlimeCredits();
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [progressStep, setProgressStep] = useState('Structuring decision');
  const [partialTrace, setPartialTrace] = useState<Record<string, unknown> | null>(null);
  const [finalTrace, setFinalTrace] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback(async (params: {
    threadId: string;
    decisionPrompt: string;
    clarificationAnswers?: Record<string, string>;
    saveClarificationToProfile?: boolean;
  }) => {
    setStatus('streaming');
    setProgressStep('Structuring decision');
    setPartialTrace(null);
    setFinalTrace(null);
    setError(null);
    setIsStreaming(true);

    let capturedTrace: Record<string, unknown> | null = null;
    let streamError: string | null = null;

    const controller = new AbortController();
    controllerRef.current = controller;

    const onEvent = (ev: Record<string, unknown>) => {
      const type = String(ev.type || '');
      if (type === 'status') {
        setProgressStep(String(ev.label || 'Generating report'));
      } else if (type === 'report_event') {
        const inner = ev.event as Record<string, unknown> | undefined;
        if (inner?.event === 'partial' && inner.data && typeof inner.data === 'object') {
          setPartialTrace((prev) => mergeStreamingPartial(prev, inner.data as Record<string, unknown>));
        }
        if (inner?.event === 'meta' && typeof inner.decision_id === 'string') {
          setPartialTrace((prev) => ({
            ...(prev ?? {}),
            decision_id: inner.decision_id,
            ...(typeof inner.timestamp === 'string' ? { timestamp: inner.timestamp } : {}),
          }));
        }
      } else if (type === 'error') {
        streamError = String(ev.message || 'Report failed');
        setError(streamError);
      } else if (type === 'done') {
        setIsStreaming(false);
        if (ev.stream_error) {
          if (!streamError) {
            streamError = 'Report failed';
            setError(streamError);
          }
          setStatus('error');
          return;
        }
        if (ev.decision_trace && typeof ev.decision_trace === 'object') {
          capturedTrace = ev.decision_trace as Record<string, unknown>;
          setFinalTrace(capturedTrace);
          setStatus('done');
        } else {
          streamError = streamError || 'Report stream finished without decision data';
          setError(streamError);
          setStatus('error');
        }
      }
    };

    try {
      const creditReq =
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `dr-${Date.now()}`;
      const res = await apiFetch(
        `/api/shadow-chat/threads/${encodeURIComponent(params.threadId)}/decision-report/stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Credit-Request-Id': creditReq },
          body: JSON.stringify({
            decision_prompt: params.decisionPrompt,
            clarification_answers: params.clarificationAnswers,
            save_clarification_to_profile: Boolean(params.saveClarificationToProfile),
            credit_request_id: creditReq,
          }),
          signal: controller.signal,
        },
      );
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
        setStatus('error');
        setIsStreaming(false);
        return { trace: null, error: 'insufficient_credits' };
      }
      if (!res.ok || !res.body) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (readErr) {
          streamError = readErr instanceof Error ? readErr.message : 'Connection lost';
          setError(streamError);
          setStatus('error');
          break;
        }
        const { done, value } = chunk;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseBlocks(buffer, onEvent);
      }
      if (buffer.trim()) {
        parseSseBlocks(`${buffer}\n\n`, onEvent);
      }
      if (!capturedTrace && !streamError) {
        streamError = 'Stream ended before the report finished';
        setError(streamError);
        setStatus('error');
      }
      return { trace: capturedTrace, error: streamError } satisfies DecisionReportStreamResult;
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        streamError = 'cancelled';
        setStatus('idle');
        setError(null);
        return { trace: null, error: streamError };
      }
      streamError = e instanceof Error ? e.message : 'report_stream_failed';
      setError(streamError);
      setStatus('error');
      return { trace: null, error: streamError };
    } finally {
      setIsStreaming(false);
    }
  }, [showInsufficient]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setStatus('idle');
    setIsStreaming(false);
  }, []);

  /** Load a persisted trace (e.g. reopen from chat artifact). Does not run the pipeline. */
  const loadExistingTrace = useCallback(async (decisionId: string) => {
    setError(null);
    setPartialTrace(null);
    setIsStreaming(false);
    try {
      const res = await apiFetch(`/api/traces/${encodeURIComponent(decisionId)}`);
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const data = (await res.json()) as Record<string, unknown>;
      setFinalTrace(data);
      setStatus('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load report';
      setError(msg);
      setStatus('error');
    }
  }, []);

  const trace = useMemo(() => finalTrace ?? partialTrace, [finalTrace, partialTrace]);
  return { status, progressStep, partialTrace, finalTrace, trace, error, start, cancel, isStreaming, loadExistingTrace };
}
