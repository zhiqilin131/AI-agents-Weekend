import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useSlimeCredits } from '../app/components/credits/SlimeCreditsContext';
import { buildCheaperModelHint, fetchSlimeModelCatalog } from '../features/models/slimeModelsApi';
import { apiFetch } from '../utils/apiFetch';
import {
  formatDegradedPayload,
  isUserVisibleDegradation,
  mergeDegradedNotices,
  noticeMessages,
  noticesFromTrace,
  shouldShowDegradedModeBanner,
  type DegradedNotice,
} from '../utils/degradedModeNotices';
import { mergeStreamingPartial } from '../utils/mergeStreamingTrace';
import { parseSseBlocks } from '../utils/parseSse';
import { prefillElicitationAnswers } from '../utils/featureAudit';
import {
  gateFromReportEvent,
  type ElicitationSubmitPayload,
  type ScoringClarifyPending,
} from '../utils/scoringClarifyGate';

function pushDegraded(
  setNotices: Dispatch<SetStateAction<DegradedNotice[]>>,
  raw: Record<string, unknown> | undefined,
) {
  if (!raw || typeof raw !== 'object' || !isUserVisibleDegradation(raw)) return;
  const notice = formatDegradedPayload(raw);
  setNotices((prev) => mergeDegradedNotices(prev, [notice]));
}

type StreamStatus = 'idle' | 'streaming' | 'gate' | 'done' | 'error';

export type DecisionReportStreamResult = {
  trace: Record<string, unknown> | null;
  error: string | null;
  awaitingScoringClarify?: boolean;
};

export function useDecisionReportStream() {
  const { showInsufficient } = useSlimeCredits();
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [progressStep, setProgressStep] = useState('Structuring decision');
  const [partialTrace, setPartialTrace] = useState<Record<string, unknown> | null>(null);
  const [finalTrace, setFinalTrace] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [degradedNotices, setDegradedNotices] = useState<DegradedNotice[]>([]);
  const [scoringClarifyPending, setScoringClarifyPending] = useState<ScoringClarifyPending | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const lastStartParamsRef = useRef<{
    threadId: string;
    decisionPrompt: string;
    clarificationAnswers?: Record<string, string>;
    saveClarificationToProfile?: boolean;
    modelOptionId?: string;
    resumeFromStage?: string;
    resumePartial?: Record<string, unknown>;
    scoringClarification?: Record<string, string>;
    comparativeAnswers?: Record<string, string[]>;
    scoringClarificationSkip?: boolean;
  } | null>(null);

  const start = useCallback(async (params: {
    threadId: string;
    decisionPrompt: string;
    clarificationAnswers?: Record<string, string>;
    saveClarificationToProfile?: boolean;
    modelOptionId?: string;
    resumeFromStage?: string;
    resumePartial?: Record<string, unknown>;
    scoringClarification?: Record<string, string>;
    comparativeAnswers?: Record<string, string[]>;
    scoringClarificationSkip?: boolean;
  }) => {
    setStatus('streaming');
    setProgressStep('Structuring decision');
    setPartialTrace(null);
    setFinalTrace(null);
    setError(null);
    setIsStreaming(true);
    setDegradedNotices([]);
    if (!params.resumeFromStage) setScoringClarifyPending(null);
    lastStartParamsRef.current = params;

    let capturedTrace: Record<string, unknown> | null = null;
    let streamError: string | null = null;
    let awaitingGate = false;
    let lastStage = (params.resumeFromStage || '').trim();
    let snapshotTrace: Record<string, unknown> | null = params.resumePartial ?? null;

    const controller = new AbortController();
    controllerRef.current = controller;

    const onEvent = (ev: Record<string, unknown>) => {
      const type = String(ev.type || '');
      if (type === 'status') {
        setProgressStep(String(ev.label || 'Generating report'));
      } else if (type === 'awaiting_scoring_clarify') {
        awaitingGate = true;
        const gate = gateFromReportEvent(ev, params.decisionPrompt);
        if (gate) {
          setScoringClarifyPending(gate);
          setStatus('gate');
          setProgressStep('Grounding tradeoff features…');
          if (gate.resumePartial) {
            snapshotTrace = mergeStreamingPartial(snapshotTrace, gate.resumePartial);
            setPartialTrace(snapshotTrace);
          }
        }
      } else if (type === 'report_event') {
        const inner = ev.event as Record<string, unknown> | undefined;
        if (inner?.event === 'partial' && inner.data && typeof inner.data === 'object') {
          snapshotTrace = mergeStreamingPartial(snapshotTrace, inner.data as Record<string, unknown>);
          setPartialTrace(snapshotTrace);
        }
        if (inner?.event === 'meta' && typeof inner.decision_id === 'string') {
          snapshotTrace = {
            ...(snapshotTrace ?? {}),
            decision_id: inner.decision_id,
            ...(typeof inner.timestamp === 'string' ? { timestamp: inner.timestamp } : {}),
          };
          setPartialTrace(snapshotTrace);
        }
        if (inner?.event === 'stage' && typeof inner.stage === 'string') {
          lastStage = inner.stage;
        }
        if (inner?.event === 'degraded' && inner.degraded && typeof inner.degraded === 'object') {
          pushDegraded(setDegradedNotices, inner.degraded as Record<string, unknown>);
        }
        if (inner?.event === 'scoring_clarify' && inner.data && typeof inner.data === 'object') {
          const clarify = inner.data as Record<string, unknown>;
          snapshotTrace = {
            ...(snapshotTrace ?? {}),
            feature_audit: {
              ...((snapshotTrace?.feature_audit as Record<string, unknown> | undefined) ?? {}),
              ...clarify,
              needs_scoring_clarification: true,
            },
          };
          setPartialTrace(snapshotTrace);
        }
      } else if (type === 'error') {
        streamError = String(ev.message || 'Report failed');
        setError(streamError);
      } else if (type === 'warning') {
        const kind = String(ev.kind || '');
        if (kind === 'degraded_mode' || ev.degraded) {
          pushDegraded(
            setDegradedNotices,
            (ev.degraded as Record<string, unknown> | undefined) ?? { reason: ev.message },
          );
        }
      } else if (type === 'pending_action_updated') {
        /* Parent clears decision dock when report stream starts. */
      } else if (type === 'done') {
        setIsStreaming(false);
        if (ev.stream_error && !ev.awaiting_scoring_clarify) {
          if (!streamError) {
            streamError = 'Report failed';
            setError(streamError);
          }
          setStatus('error');
          return;
        }
        if (ev.awaiting_scoring_clarify || awaitingGate) {
          setStatus('gate');
          return;
        }
        if (ev.decision_trace && typeof ev.decision_trace === 'object') {
          capturedTrace = ev.decision_trace as Record<string, unknown>;
          setDegradedNotices((prev) => mergeDegradedNotices(prev, noticesFromTrace(capturedTrace)));
          setFinalTrace(capturedTrace);
          setScoringClarifyPending(null);
          setStatus('done');
        } else if (!awaitingGate) {
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
            ...(params.modelOptionId ? { model_option_id: params.modelOptionId } : {}),
            ...(params.resumeFromStage ? { resume_from_stage: params.resumeFromStage } : {}),
            ...(params.resumePartial ? { resume_partial: params.resumePartial } : {}),
            ...(params.scoringClarification ? { scoring_clarification: params.scoringClarification } : {}),
            ...(params.comparativeAnswers ? { comparative_answers: params.comparativeAnswers } : {}),
            ...(params.scoringClarificationSkip ? { scoring_clarification_skip: true } : {}),
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
        let cheaperHint: string | undefined;
        try {
          const cat = await fetchSlimeModelCatalog();
          const mid = (params.modelOptionId || cat.default_model || '').trim() || 'little';
          cheaperHint =
            cat.models.length > 0 ? await buildCheaperModelHint('decision_report', mid, cat.models) : undefined;
        } catch {
          cheaperHint = undefined;
        }
        showInsufficient({
          required: Number(j.required ?? 0),
          balance: typeof j.balance === 'number' ? j.balance : null,
          message:
            typeof j.message === 'string'
              ? j.message
              : 'You need more Slime Credits for this action.',
          cheaperHint,
        });
        setPartialTrace(null);
        setFinalTrace(null);
        setError(null);
        setProgressStep('Structuring decision');
        setStatus('idle');
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
      if (!capturedTrace && !streamError && !awaitingGate) {
        streamError = 'Stream ended before the report finished';
        setError(streamError);
        setStatus('error');
      }
      if (streamError) {
        lastStartParamsRef.current = {
          ...params,
          resumeFromStage: lastStage || 'enhance',
          resumePartial: snapshotTrace ?? undefined,
        };
      }
      return {
        trace: capturedTrace,
        error: streamError,
        awaitingScoringClarify: awaitingGate,
      } satisfies DecisionReportStreamResult;
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

  const applyScoringClarify = useCallback(
    (payload: ElicitationSubmitPayload) => {
      const pending = scoringClarifyPending;
      if (!pending) return;
      setScoringClarifyPending(null);
      void start({
        threadId: lastStartParamsRef.current?.threadId ?? '',
        decisionPrompt: pending.decisionPrompt,
        modelOptionId: lastStartParamsRef.current?.modelOptionId,
        resumeFromStage: 'evaluate',
        resumePartial: pending.resumePartial,
        scoringClarification: payload.scoring_clarification,
        comparativeAnswers: payload.comparative_answers,
      });
    },
    [scoringClarifyPending, start],
  );

  const skipScoringClarify = useCallback(() => {
    const pending = scoringClarifyPending;
    if (!pending) return;
    setScoringClarifyPending(null);
    void start({
      threadId: lastStartParamsRef.current?.threadId ?? '',
      decisionPrompt: pending.decisionPrompt,
      modelOptionId: lastStartParamsRef.current?.modelOptionId,
      resumeFromStage: 'evaluate',
      resumePartial: pending.resumePartial,
      scoringClarificationSkip: true,
    });
  }, [scoringClarifyPending, start]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setStatus('idle');
    setIsStreaming(false);
    setScoringClarifyPending(null);
  }, []);

  const retryFromCurrentStage = useCallback(async () => {
    const p = lastStartParamsRef.current;
    if (!p) return { trace: null, error: 'missing_previous_params' } as DecisionReportStreamResult;
    return start({
      ...p,
      resumeFromStage: p.resumeFromStage || 'enhance',
      resumePartial: p.resumePartial,
    });
  }, [start]);

  const loadExistingTrace = useCallback(async (decisionId: string) => {
    setError(null);
    setPartialTrace(null);
    setIsStreaming(false);
    setScoringClarifyPending(null);
    try {
      const res = await apiFetch(`/api/traces/${encodeURIComponent(decisionId)}`);
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const data = (await res.json()) as Record<string, unknown>;
      setDegradedNotices(noticesFromTrace(data));
      setFinalTrace(data);
      setStatus('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load report';
      setError(msg);
      setStatus('error');
    }
  }, []);

  const updateTrace = useCallback((trace: Record<string, unknown>) => {
    setFinalTrace(trace);
    setPartialTrace(null);
    setScoringClarifyPending(null);
    setStatus('done');
  }, []);

  const trace = useMemo(() => finalTrace ?? partialTrace, [finalTrace, partialTrace]);
  const gatePrefill = useMemo(() => {
    const src = scoringClarifyPending?.resumePartial ?? trace;
    return prefillElicitationAnswers(src as Record<string, unknown> | null);
  }, [scoringClarifyPending, trace]);

  return {
    status,
    progressStep,
    partialTrace,
    finalTrace,
    trace,
    error,
    scoringClarifyPending,
    gatePrefill,
    applyScoringClarify,
    skipScoringClarify,
    updateTrace,
    degradedWarnings: shouldShowDegradedModeBanner(degradedNotices, {
      streamError: status === 'error',
    })
      ? noticeMessages(degradedNotices)
      : [],
    degradedNotices,
    start,
    cancel,
    retryFromCurrentStage,
    isStreaming,
    loadExistingTrace,
  };
}
