import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { ClarifyQuestion } from '../app/components/ClarifyDialog';
import { ThreadActionDock } from '../app/components/shadow/ThreadActionDock';
import { buildClarificationPendingAction, type PendingAction } from '../app/components/shadow/pendingActionTypes';
import { InputPanel } from '../app/components/InputPanel';
import { MainNavButtons } from '../app/components/MainNavButtons';
import { DecisionQuestionStrip } from '../app/components/DecisionQuestionStrip';
import { ReportPanel } from '../app/components/ReportPanel';
import { OutcomeHarness } from '../app/components/OutcomeHarness';
import { mapTraceToReport } from '../utils/mapTrace';
import { mergeStreamingPartial } from '../utils/mergeStreamingTrace';
import { apiFetch } from '../utils/apiFetch';
import { parseSseBlocks } from '../utils/parseSse';
import { isUserVisibleDegradation } from '../utils/degradedModeNotices';
import type { AppState, DecisionReport } from '../app/model';
import { HomeRoamingSlime } from '../app/components/home/HomeRoamingSlime';
import { SlimeLandingCta } from '../app/components/home/SlimeLandingCta';
import { useSlimeCredits } from '../app/components/credits/SlimeCreditsContext';
import { ModelSelector } from '../features/models/ModelSelector';
import { buildCheaperModelHint } from '../features/models/slimeModelsApi';
import { useSlimeModelCatalog } from '../features/models/useSlimeModelCatalog';
import { useSlimeProfile } from '../hooks/useSlimeProfile';
import { nowIso, shouldShowOnboarding } from '../features/onboarding/onboarding';
import type { UserProfile } from '../features/onboarding/types';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseEnvConfigured } from '../auth/RequireAuthLayout';

const PIPELINE_STAGES = ['enhance', 'perceive', 'retrieve', 'infer', 'simulate', 'evaluate', 'finalize'] as const;

const STAGE_LABEL: Record<string, string> = {
  enhance: 'Clarifying your question',
  perceive: 'Understanding your situation',
  retrieve: 'Retrieving memory & world evidence',
  infer: 'Bias check & option generation',
  simulate: 'Simulating futures per option',
  evaluate: 'Scoring trade-offs',
  finalize: 'Recommendation & reflection',
};

function stageToProgress(stage: string): number {
  const i = PIPELINE_STAGES.indexOf(stage as (typeof PIPELINE_STAGES)[number]);
  if (i < 0) return 5;
  return Math.round(((i + 1) / PIPELINE_STAGES.length) * 100);
}

type StreamOpts = {
  clarification_answers?: Record<string, string>;
  save_clarification_to_profile?: boolean;
  preserve_raw_input?: boolean;
  resume_from_stage?: string;
  resume_partial?: Record<string, unknown>;
};

type DegradeNotice = {
  at: string;
  message: string;
  stage?: string;
  retryable?: boolean;
};

type Tier3ProfileView = {
  profile: {
    user_id?: string;
    values?: string[];
    risk_posture?: string;
    recurring_themes?: string[];
    current_goals?: string[];
    known_constraints?: string[];
    n_decisions_summarized?: number;
    last_updated?: string;
    confidence?: number;
  };
  used_in_recommender: boolean;
  use_threshold: number;
  source: string;
};

export default function HomePage() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const routeTraceId = useParams().decisionId;
  const { showInsufficient, refresh: refreshCredits } = useSlimeCredits();
  const slimeModels = useSlimeModelCatalog();
  const { slimeProfile } = useSlimeProfile();
  const [runModelOptionId, setRunModelOptionId] = useState('');
  useEffect(() => {
    if (slimeModels.ready && slimeModels.defaultModel && !runModelOptionId) {
      setRunModelOptionId(slimeModels.defaultModel);
    }
  }, [slimeModels.ready, slimeModels.defaultModel, runModelOptionId]);

  const [state, setState] = useState<AppState>(() => (routeTraceId ? 'loading' : 'empty'));
  const [decisionInput, setDecisionInput] = useState('');
  const [fullTrace, setFullTrace] = useState<Record<string, unknown> | null>(null);
  const [liveTrace, setLiveTrace] = useState<Record<string, unknown> | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [tracePath, setTracePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [showOutcome, setShowOutcome] = useState(false);
  const [loadingStage, setLoadingStage] = useState<string | null>(null);
  const [runProgress, setRunProgress] = useState(0);
  const [runStageLabel, setRunStageLabel] = useState('Starting…');
  const [tier3Profile, setTier3Profile] = useState<Tier3ProfileView | null>(null);
  const [clarifyChecking, setClarifyChecking] = useState(false);
  const [homePendingAction, setHomePendingAction] = useState<PendingAction | null>(null);
  const clarifyOpen = homePendingAction?.type === 'clarification';
  /** Shown only when clarify fails or LLM is missing — not when the model simply says no extra questions. */
  const [clarifyGateHint, setClarifyGateHint] = useState<string | null>(null);
  const [degradeNotices, setDegradeNotices] = useState<DegradeNotice[]>([]);
  const [lastFailedStage, setLastFailedStage] = useState<string | null>(null);
  const [onboardingReminder, setOnboardingReminder] = useState<{ missingCount: number; profile: UserProfile } | null>(null);
  const onboardingNavigationDoneRef = useRef(false);
  const loadingStageRef = useRef<string | null>(null);
  useEffect(() => {
    loadingStageRef.current = loadingStage;
  }, [loadingStage]);
  const prevTraceIdRef = useRef<string | undefined>(undefined);
  const retrySnapshotRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    const prev = prevTraceIdRef.current;
    prevTraceIdRef.current = routeTraceId;
    if (prev !== undefined && routeTraceId === undefined) {
      setFullTrace(null);
      setLiveTrace(null);
      setNotes([]);
      setTracePath(null);
      setDecisionInput('');
      setState('empty');
      setError(null);
    }
  }, [routeTraceId]);

  useEffect(() => {
    if (!routeTraceId) return;
    if (
      fullTrace &&
      typeof fullTrace.decision_id === 'string' &&
      fullTrace.decision_id === routeTraceId
    ) {
      return;
    }
    let cancelled = false;
    setError(null);
    setState('loading');
    setRunStageLabel('Loading saved decision…');
    setLiveTrace(null);
    void (async () => {
      try {
        const res = await apiFetch(`/api/traces/${encodeURIComponent(routeTraceId)}`);
        if (!res.ok) throw new Error(await res.text());
        const trace = (await res.json()) as Record<string, unknown>;
        if (cancelled) return;
        setFullTrace(trace);
        if (typeof trace.original_user_input === 'string') {
          setDecisionInput(trace.original_user_input);
        }
        setNotes([]);
        setTracePath(null);
        setState('result');
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load saved decision');
          setState('empty');
        }
      } finally {
        if (!cancelled) setRunStageLabel('Starting…');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeTraceId, fullTrace]);

  const displayReport = useMemo((): DecisionReport | null => {
    if (state === 'result' && fullTrace) return mapTraceToReport(fullTrace);
    if (liveTrace) return mapTraceToReport(liveTrace);
    return null;
  }, [state, fullTrace, liveTrace]);

  const traceForPanel = state === 'result' ? fullTrace : liveTrace;

  const loadTier3Profile = useCallback(async () => {
    try {
      const res = await apiFetch('/api/profile/tier3');
      if (!res.ok) return;
      const data = (await res.json()) as Tier3ProfileView;
      if (data && typeof data === 'object') setTier3Profile(data);
    } catch {
      // non-blocking diagnostics panel
    }
  }, []);

  useEffect(() => {
    void loadTier3Profile();
  }, [loadTier3Profile]);

  useEffect(() => {
    let cancelled = false;
    if (onboardingNavigationDoneRef.current) return;
    if (authLoading) return;
    if (isSupabaseEnvConfigured() && !session) return;
    void (async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
        try {
          const res = await apiFetch('/api/profile');
          if (!res.ok) {
            if (res.status === 401 && attempt < 2) {
              await new Promise((resolve) => window.setTimeout(resolve, 450));
              continue;
            }
            return;
          }
          const profile = (await res.json()) as UserProfile;
          if (cancelled) return;
          const trigger = shouldShowOnboarding(profile);
          if (trigger === 'force_initial') {
            onboardingNavigationDoneRef.current = true;
            navigate('/onboarding?mode=force_initial', { replace: true });
            return;
          }
          if (trigger === 'gentle_reminder') {
            const missingCount = profile.personal_profile?.onboardingStatus?.skippedQuestions?.length ?? 0;
            setOnboardingReminder({ missingCount, profile });
            return;
          }
          setOnboardingReminder(null);
          return;
        } catch {
          if (attempt < 2) {
            await new Promise((resolve) => window.setTimeout(resolve, 450));
            continue;
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, authLoading, session]);

  const postponeOnboardingReminder = useCallback(async () => {
    if (!onboardingReminder) return;
    const previousStatus = onboardingReminder.profile.personal_profile?.onboardingStatus;
    const nextStatus = {
      completed: Boolean(previousStatus?.completed),
      completedAt: previousStatus?.completedAt,
      skippedQuestions: previousStatus?.skippedQuestions ?? [],
      lastPromptedAt: nowIso(),
      promptCount: (previousStatus?.promptCount ?? 0) + 1,
    };
    const body: UserProfile = {
      ...onboardingReminder.profile,
      personal_profile: {
        priorities: onboardingReminder.profile.personal_profile?.priorities ?? [],
        valuesProfile: onboardingReminder.profile.personal_profile?.valuesProfile ?? {
          pvqResponses: [],
          narrative: '',
          generatedAt: '',
          editedByUser: false,
        },
        onboardingStatus: nextStatus,
      },
      user_priorities: onboardingReminder.profile.user_priorities ?? onboardingReminder.profile.priorities ?? [],
      priorities: onboardingReminder.profile.user_priorities ?? onboardingReminder.profile.priorities ?? [],
      values: onboardingReminder.profile.values ?? [],
      constraints: onboardingReminder.profile.constraints ?? [],
      about_me: String(onboardingReminder.profile.about_me ?? ''),
      timezone: String(onboardingReminder.profile.timezone ?? 'UTC'),
      default_model_option_id: String(onboardingReminder.profile.default_model_option_id ?? ''),
    };
    try {
      await apiFetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // best effort
    } finally {
      setOnboardingReminder(null);
    }
  }, [onboardingReminder]);

  const runPipelineStream = useCallback(
    async (opts?: StreamOpts) => {
      setError(null);
      setState('loading');
      setLoadingStage('enhance');
      setRunProgress(4);
      setRunStageLabel('Connecting to pipeline…');
      setLiveTrace(null);
      setFullTrace(null);
      setLastFailedStage(null);
      setDegradeNotices([]);
      if (!opts?.resume_from_stage) retrySnapshotRef.current = null;

      const controller = new AbortController();
      const RUN_TIMEOUT_MS = 300_000;
      const timeoutId = window.setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
      let streamTrace: Record<string, unknown> | null = opts?.resume_partial ?? null;

      try {
        const body: Record<string, unknown> = {
          raw_input: decisionInput,
          client_now_iso: new Date().toISOString(),
        };
        if (opts?.clarification_answers && Object.keys(opts.clarification_answers).length > 0) {
          body.clarification_answers = opts.clarification_answers;
          body.save_clarification_to_profile = Boolean(opts.save_clarification_to_profile);
        }
        if (opts?.preserve_raw_input) {
          body.preserve_raw_input = true;
        }
        if (opts?.resume_from_stage) {
          body.resume_from_stage = opts.resume_from_stage;
          if (opts.resume_partial && typeof opts.resume_partial === 'object') {
            body.resume_partial = opts.resume_partial;
          }
        }
        if (runModelOptionId) {
          body.model_option_id = runModelOptionId;
        }

        const runCredit =
          typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `run-${Date.now()}`;
        const res = await apiFetch('/api/run/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Credit-Request-Id': runCredit,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (res.status === 402) {
          let j: Record<string, unknown> = {};
          try {
            j = (await res.json()) as Record<string, unknown>;
          } catch {
            /* ignore */
          }
          const mid = runModelOptionId || slimeModels.defaultModel || 'little';
          const cheaperHint =
            slimeModels.models.length > 0
              ? await buildCheaperModelHint('decision_report', mid, slimeModels.models)
              : undefined;
          showInsufficient({
            required: Number(j.required ?? 0),
            balance: typeof j.balance === 'number' ? j.balance : null,
            message:
              typeof j.message === 'string'
                ? j.message
                : 'You need more Slime Credits for this action.',
            cheaperHint,
          });
          window.clearTimeout(timeoutId);
          setLoadingStage(null);
          setState('empty');
          setRunProgress(0);
          setRunStageLabel('Ready');
          return;
        }
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || res.statusText);
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buf = '';
        let gotNotes: string[] = [];
        let trace: Record<string, unknown> | null = null;
        let path: string | null = null;

        const consume = (data: Record<string, unknown>) => {
          if (data.event === 'error') {
            const d = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
            throw new Error(d || 'Pipeline error');
          }
          if (data.event === 'notes' && Array.isArray(data.notes)) {
            gotNotes = data.notes as string[];
          }
          if (data.event === 'meta') {
            if (typeof data.decision_id === 'string') {
              streamTrace = {
                ...(streamTrace ?? {}),
                decision_id: data.decision_id,
                ...(typeof data.timestamp === 'string' ? { timestamp: data.timestamp } : {}),
              };
              retrySnapshotRef.current = streamTrace;
              setLiveTrace(streamTrace);
            }
          }
          if (data.event === 'partial' && data.data && typeof data.data === 'object') {
            streamTrace = mergeStreamingPartial(streamTrace, data.data as Record<string, unknown>);
            retrySnapshotRef.current = streamTrace;
            setLiveTrace(streamTrace);
          }
          if (data.event === 'stage' && typeof data.stage === 'string') {
            const st = data.stage;
            setLoadingStage(st);
            setRunProgress(stageToProgress(st));
            setRunStageLabel(STAGE_LABEL[st] ?? st);
          }
          if (data.event === 'degraded' && data.degraded && typeof data.degraded === 'object') {
            const d = data.degraded as Record<string, unknown>;
            if (isUserVisibleDegradation(d)) {
              const msg = String(d.reason || 'Running in degraded mode');
              const key = `${String(d.at || '')}:${msg}`;
              setDegradeNotices((prev) => {
                if (prev.some((x) => `${x.at}:${x.message}` === key)) return prev;
                return [
                  ...prev.slice(-3),
                  {
                    at: String(d.at || new Date().toISOString()),
                    message: msg,
                    stage: String(d.stage || ''),
                    retryable: Boolean(d.retryable),
                  },
                ];
              });
            }
          }
          if (data.event === 'complete' && data.trace && typeof data.trace === 'object') {
            trace = data.trace as Record<string, unknown>;
            if (typeof data.trace_path === 'string') path = data.trace_path;
            setRunProgress(100);
            setRunStageLabel('Done');
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          buf = parseSseBlocks(buf, consume);
        }
        if (buf.trim()) {
          parseSseBlocks(`${buf}\n\n`, consume);
        }
        if (!trace) throw new Error('Incomplete response (no trace)');

        void refreshCredits();
        setLiveTrace(null);
        setFullTrace(trace);
        setNotes(gotNotes);
        setTracePath(path);
        setClarifyGateHint(null);
        setState('result');
        retrySnapshotRef.current = null;
        void loadTier3Profile();
        const tid = trace.decision_id;
        if (typeof tid === 'string' && tid) {
          navigate(`/trace/${tid}`, { replace: true });
        }
      } catch (e) {
        let msg = e instanceof Error ? e.message : 'Run failed';
        if (e instanceof Error && e.name === 'AbortError') {
          msg =
            'Run timed out (5 min). Ensure API is on 8765 (`npm run dev:all` from web/ or `python -m uvicorn …`), OPENAI_API_KEY is set, and `.env.development` has VITE_API_ORIGIN=http://127.0.0.1:8765 for streaming.';
        }
        setError(msg);
        setLastFailedStage(loadingStageRef.current);
        setClarifyGateHint(null);
        setState('empty');
        if (streamTrace) retrySnapshotRef.current = streamTrace;
        setLiveTrace(null);
      } finally {
        window.clearTimeout(timeoutId);
        setLoadingStage(null);
        setRunProgress(0);
      }
    },
    [decisionInput, loadTier3Profile, navigate, refreshCredits, runModelOptionId, showInsufficient, slimeModels],
  );

  const handleRunDecision = async () => {
    if (state === 'loading' || clarifyChecking || clarifyOpen) return;
    setError(null);
    setClarifyGateHint(null);
    setClarifyChecking(true);
    try {
      const clarifyCredit =
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `clarify-${Date.now()}`;
      const cr = await apiFetch('/api/clarify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Credit-Request-Id': clarifyCredit,
        },
        body: JSON.stringify({
          raw_input: decisionInput,
          ...(runModelOptionId ? { model_option_id: runModelOptionId } : {}),
        }),
      });
      if (cr.status === 402) {
        let j: Record<string, unknown> = {};
        try {
          j = (await cr.json()) as Record<string, unknown>;
        } catch {
          /* ignore */
        }
        const mid = runModelOptionId || slimeModels.defaultModel || 'little';
        const cheaperHint =
          slimeModels.models.length > 0
            ? await buildCheaperModelHint('shadow_chat', mid, slimeModels.models)
            : undefined;
        showInsufficient({
          required: Number(j.required ?? 0),
          balance: typeof j.balance === 'number' ? j.balance : null,
          message:
            typeof j.message === 'string'
              ? j.message
              : 'You need more Slime Credits for this action.',
          cheaperHint,
        });
        setClarifyChecking(false);
        return;
      }
      if (cr.ok) {
        const gate = (await cr.json()) as {
          need_clarification?: boolean;
          questions?: ClarifyQuestion[];
          note?: string;
          skip_reason?: string;
        };
        if (gate.need_clarification && Array.isArray(gate.questions) && gate.questions.length > 0) {
          const gatePa = (gate as { pending_action?: PendingAction }).pending_action;
          setHomePendingAction(
            gatePa?.type === 'clarification'
              ? gatePa
              : buildClarificationPendingAction(gate.questions, null, String(gate.note ?? '')),
          );
          setState('empty');
          setLoadingStage(null);
          setRunProgress(0);
          setRunStageLabel('Starting…');
          setClarifyChecking(false);
          return;
        }
        // No modal: either input was specific enough (not_needed) or gate unavailable — see clarifyGateHint.
        if (gate.skip_reason === 'error') {
          setClarifyGateHint(
            'Clarification check failed (model/network). Continuing with your raw text (no enhancement rewrite).',
          );
          setClarifyChecking(false);
          await runPipelineStream({ preserve_raw_input: true });
          return;
        } else if (gate.skip_reason === 'no_llm') {
          setClarifyGateHint('Optional clarification is off: API has no LLM configured. Running analysis anyway.');
        }
      }
    } catch {
      /* optional gate — same as skip_reason error: proceed to pipeline */
      setClarifyGateHint('Could not reach clarification endpoint; continuing with your raw text.');
      setClarifyChecking(false);
      await runPipelineStream({ preserve_raw_input: true });
      return;
    }
    setClarifyChecking(false);
    await runPipelineStream();
  };

  const handleReset = () => {
    setState('empty');
    setDecisionInput('');
    setFullTrace(null);
    setLiveTrace(null);
    setNotes([]);
    setTracePath(null);
    setShowJson(false);
    setShowOutcome(false);
    setError(null);
    setClarifyGateHint(null);
    setHomePendingAction(null);
    setLoadingStage(null);
    setCommitInfo(null);
    setCommitError(null);
    if (routeTraceId) navigate('/', { replace: true });
  };

  const decisionId =
    (fullTrace && typeof fullTrace.decision_id === 'string' ? fullTrace.decision_id : null) ??
    (liveTrace && typeof liveTrace.decision_id === 'string' ? liveTrace.decision_id : null);

  type CommitInfo = { chosen_option_id: string; matches_recommendation: boolean; committed_at: string };
  const [commitInfo, setCommitInfo] = useState<CommitInfo | null>(null);
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  useEffect(() => {
    if (!decisionId || state !== 'result') {
      setCommitInfo(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch(`/api/commits/${encodeURIComponent(decisionId)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setCommitInfo(null);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as CommitInfo;
        setCommitInfo(data);
      } catch {
        if (!cancelled) setCommitInfo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [decisionId, state, fullTrace]);

  const handleCommitAdopt = useCallback(
    async (chosenOptionId: string) => {
      if (!decisionId) return;
      setCommitBusy(true);
      setCommitError(null);
      try {
        const res = await apiFetch('/api/commit-decision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision_id: decisionId, chosen_option_id: chosenOptionId }),
        });
        if (!res.ok) throw new Error(await res.text());
        const gr = await apiFetch(`/api/commits/${encodeURIComponent(decisionId)}`);
        if (gr.ok) setCommitInfo((await gr.json()) as CommitInfo);
      } catch (e) {
        setCommitError(e instanceof Error ? e.message : 'Commit failed');
      } finally {
        setCommitBusy(false);
      }
    },
    [decisionId],
  );

  const nav = <MainNavButtons />;
  const navLanding = <MainNavButtons className="!mb-4 sm:!mb-5" />;
  const onboardingReminderBanner = onboardingReminder ? (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/90 px-4 py-2.5 text-sm text-indigo-950">
      You still have {onboardingReminder.missingCount} basic setup item(s) incomplete. If you finish them, I can give more tailored suggestions.{' '}
      <button
        type="button"
        className="font-semibold underline underline-offset-4"
        onClick={() => navigate('/onboarding?mode=gentle_reminder')}
      >
        Continue setup
      </button>{' '}
      <button
        type="button"
        className="ml-2 text-indigo-700 underline underline-offset-4"
        onClick={() => void postponeOnboardingReminder()}
      >
        Maybe later
      </button>
    </div>
  ) : null;

  const workspace = (
    <div className="max-w-[1600px] mx-auto px-6 lg:px-10 pt-4 pb-16 lg:pt-5">
      {nav}

      <header className="mb-6">
        <h1 className="text-3xl md:text-4xl text-gray-900 tracking-tight" style={{ fontWeight: 700, letterSpacing: '-0.03em' }}>
          Foresight-<span className="text-purple-600">X</span>
        </h1>
        <p className="text-sm md:text-base text-gray-500 mt-1" style={{ fontWeight: 400 }}>
          Evidence-grounded decision agent
        </p>
      </header>

      <DecisionQuestionStrip decisionInput={decisionInput} report={displayReport} />
      {onboardingReminderBanner}

      {degradeNotices.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200/90 bg-amber-50/95 px-4 py-2.5 text-xs text-amber-950">
          <p className="font-semibold">Degraded mode detected</p>
          <ul className="mt-1 space-y-1">
            {degradeNotices.slice(-2).map((n) => (
              <li key={`${n.at}:${n.message}`}>{n.message}</li>
            ))}
          </ul>
        </div>
      )}

      {clarifyGateHint && state === 'loading' && (
        <div className="mb-4 text-xs text-amber-950 bg-amber-50/95 border border-amber-200/80 rounded-xl px-4 py-2.5 leading-relaxed">
          {clarifyGateHint}
        </div>
      )}

      {notes.length > 0 && state === 'result' && (
        <div className="mb-4 space-y-2">
          {notes.map((n) => (
            <div
              key={n}
              className="text-sm text-blue-900 bg-blue-50/90 border border-blue-200/60 rounded-xl px-4 py-2"
            >
              {n}
            </div>
          ))}
        </div>
      )}
      {tracePath && state === 'result' && (
        <p className="mb-6 text-sm text-emerald-800 bg-emerald-50/90 border border-emerald-200/60 rounded-xl px-4 py-2">
          Trace saved to {tracePath}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        <aside className="lg:col-span-4">
          <div className="mb-3">
            <ModelSelector
              feature="decision_report"
              selectedModelId={runModelOptionId || slimeModels.defaultModel}
              onChange={setRunModelOptionId}
              models={slimeModels.models}
              selectorEnabled={slimeModels.selectorEnabled}
              showCostPreview
              variant="compact"
              label="Model for this run"
              hint="Defaults to the lowest-cost tier; upgrade for heavier reasoning."
              disabled={state === 'loading'}
            />
          </div>
          {homePendingAction ? (
            <ThreadActionDock
              pendingAction={homePendingAction}
              disabled={state === 'loading'}
              onClarifySkip={() => {
                setHomePendingAction(null);
                void runPipelineStream();
              }}
              onClarifyAnswer={(answers, saveToProfile) => {
                setHomePendingAction(null);
                void runPipelineStream({
                  clarification_answers: answers,
                  save_clarification_to_profile: saveToProfile,
                });
              }}
              onGenerateDecisionReport={() => {}}
              onDismissSuggestion={() => setHomePendingAction(null)}
            />
          ) : null}
          <InputPanel
            decisionInput={decisionInput}
            onInputChange={setDecisionInput}
            onRun={handleRunDecision}
            onReset={handleReset}
            state={state}
            isClarifyChecking={clarifyChecking}
            clarifyOpen={clarifyOpen}
            loadingStage={loadingStage}
            stageLabel={STAGE_LABEL}
            onVoiceTranscript={(t) =>
              setDecisionInput((s) => {
                const x = s.trim();
                return x ? `${x} ${t}` : t;
              })
            }
          />
        </aside>

        <section className="lg:col-span-8 min-h-[200px]">
          <ReportPanel
            state={state}
            report={displayReport}
            fullTrace={traceForPanel}
            tier3Profile={tier3Profile}
            showJson={showJson}
            onToggleJson={() => setShowJson(!showJson)}
            onShowOutcome={() => setShowOutcome(true)}
            canRecordOutcome={Boolean(decisionId)}
            decisionId={decisionId}
            commitInfo={commitInfo}
            onCommitAdopt={handleCommitAdopt}
            commitBusy={commitBusy}
            commitError={commitError}
            runProgress={runProgress}
            runStageLabel={runStageLabel}
          />
        </section>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff]">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-[500px] h-[500px] bg-gradient-to-br from-purple-300/30 to-pink-300/30 rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 right-10 w-[500px] h-[500px] bg-gradient-to-br from-blue-300/30 to-purple-300/30 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-purple-200/20 to-blue-200/20 rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10">
        {state === 'empty' ? (
          <div className="relative flex min-h-screen flex-col items-center px-6 pb-12 pt-3 sm:px-8 sm:pt-4 md:pt-5">
            <div className="w-full max-w-3xl">
              {navLanding}
              <div className="mt-10 w-full sm:mt-14 md:mt-20">
                <div className="mb-12 text-center sm:mb-14">
                  <h1 className="mb-4 text-6xl text-gray-900 tracking-tight sm:mb-5 sm:text-7xl" style={{ fontWeight: 700, letterSpacing: '-0.04em' }}>
                    Foresight-<span className="text-purple-600">X</span>
                  </h1>
                  <p className="text-lg text-gray-500 sm:text-xl" style={{ fontWeight: 400 }}>
                    Evidence-grounded decision agent
                  </p>
                </div>

                {error && (
                  <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-sm">{error}</div>
                )}
                {error && lastFailedStage ? (
                  <div className="mb-6 rounded-2xl border border-amber-200/90 bg-amber-50/95 p-3 text-sm text-amber-950">
                    <p className="font-medium">
                      Last failed stage: {STAGE_LABEL[lastFailedStage] ?? lastFailedStage}
                    </p>
                    <button
                      type="button"
                      className="mt-2 rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                      onClick={() => {
                        void runPipelineStream({
                          resume_from_stage: lastFailedStage,
                          resume_partial: retrySnapshotRef.current ?? undefined,
                        });
                      }}
                    >
                      Retry this stage
                    </button>
                  </div>
                ) : null}

                <div className="mx-auto max-w-xl text-center">
                  {onboardingReminderBanner}
                  <SlimeLandingCta profile={slimeProfile} onClick={() => navigate('/buddy')} />
                </div>
              </div>
            </div>
          </div>
        ) : (
          workspace
        )}
        {state === 'empty' ? <HomeRoamingSlime /> : null}
      </div>

      {showOutcome && decisionId && (
        <OutcomeHarness
          decisionId={decisionId}
          onClose={() => setShowOutcome(false)}
        />
      )}
    </div>
  );
}
