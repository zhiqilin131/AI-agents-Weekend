/** Static resilience architecture model for the judge-facing interactive explorer. */

export type ResilienceScenarioId =
  | 'healthy'
  | 'primary_5xx'
  | 'primary_429'
  | 'tavily_outage'
  | 'linear_mcp_outage'
  | 'recovery';

export type NodeStatus = 'ok' | 'stress' | 'fallback' | 'bypass';

export type ResilienceNodeId =
  | 'user'
  | 'api'
  | 'sse'
  | 'pipeline'
  | 'stage_enhance'
  | 'stage_perceive'
  | 'stage_retrieve'
  | 'stage_infer'
  | 'stage_simulate'
  | 'stage_evaluate'
  | 'stage_finalize'
  | 'llm_gateway'
  | 'llm_primary'
  | 'llm_fallback'
  | 'tavily'
  | 'linear_mcp'
  | 'circuit'
  | 'chaos'
  | 'trace';

export type ResilienceNode = {
  id: ResilienceNodeId;
  label: string;
  short: string;
  layer: 'surface' | 'pipeline' | 'dependency' | 'guard';
  icon: 'user' | 'api' | 'pipeline' | 'llm' | 'search' | 'mcp' | 'shield' | 'flask';
  parent?: ResilienceNodeId;
};

export type ResilienceScenario = {
  id: ResilienceScenarioId;
  label: string;
  tagline: string;
  judgePitch: string;
  injectedFault: string;
  stillDelivers: string;
  nodeStatus: Partial<Record<ResilienceNodeId, NodeStatus>>;
  pipelineNote: string;
};

export const PIPELINE_STAGES: ResilienceNodeId[] = [
  'stage_enhance',
  'stage_perceive',
  'stage_retrieve',
  'stage_infer',
  'stage_simulate',
  'stage_evaluate',
  'stage_finalize',
];

/** Matches `foresight_x/orchestration/pipeline.py` `_PIPELINE_STAGE_ORDER`. */
export const PIPELINE_STAGE_META: {
  id: ResilienceNodeId;
  key: string;
  order: number;
  usesLlm: boolean;
  usesTavily: boolean;
  fallback: string;
}[] = [
  { id: 'stage_enhance', key: 'enhance', order: 1, usesLlm: true, usesTavily: false, fallback: 'Raw question (no LLM rewrite)' },
  { id: 'stage_perceive', key: 'perceive', order: 2, usesLlm: true, usesTavily: false, fallback: 'Template user-state from profile' },
  { id: 'stage_retrieve', key: 'retrieve', order: 3, usesLlm: false, usesTavily: true, fallback: 'Empty evidence bundle' },
  { id: 'stage_infer', key: 'infer', order: 4, usesLlm: true, usesTavily: false, fallback: 'Deterministic option templates' },
  { id: 'stage_simulate', key: 'simulate', order: 5, usesLlm: true, usesTavily: false, fallback: 'Heuristic futures per option' },
  { id: 'stage_evaluate', key: 'evaluate', order: 6, usesLlm: true, usesTavily: false, fallback: 'Rule-based scoring' },
  { id: 'stage_finalize', key: 'finalize', order: 7, usesLlm: true, usesTavily: false, fallback: 'Assemble recommendation + reflection' },
];

export const REQUEST_PATH: { id: ResilienceNodeId; caption: string }[] = [
  { id: 'user', caption: 'User question' },
  { id: 'api', caption: 'POST /api/run/stream' },
  { id: 'sse', caption: 'SSE: stage · degraded · complete' },
  { id: 'trace', caption: 'DecisionTrace + report_surface' },
];

export const RESILIENCE_NODES: Record<ResilienceNodeId, ResilienceNode> = {
  user: { id: 'user', label: 'User', short: 'User', layer: 'surface', icon: 'user' },
  api: { id: 'api', label: 'FastAPI', short: 'API', layer: 'surface', icon: 'api' },
  sse: { id: 'sse', label: 'SSE stream', short: 'SSE', layer: 'surface', icon: 'api', parent: 'api' },
  pipeline: { id: 'pipeline', label: 'Decision pipeline', short: 'Pipeline', layer: 'pipeline', icon: 'pipeline' },
  stage_enhance: {
    id: 'stage_enhance',
    label: 'Enhance',
    short: 'Enhance',
    layer: 'pipeline',
    icon: 'pipeline',
    parent: 'pipeline',
  },
  stage_perceive: {
    id: 'stage_perceive',
    label: 'Perceive',
    short: 'Perceive',
    layer: 'pipeline',
    icon: 'pipeline',
    parent: 'pipeline',
  },
  stage_retrieve: {
    id: 'stage_retrieve',
    label: 'Retrieve',
    short: 'Retrieve',
    layer: 'pipeline',
    icon: 'pipeline',
    parent: 'pipeline',
  },
  stage_infer: {
    id: 'stage_infer',
    label: 'Infer',
    short: 'Infer',
    layer: 'pipeline',
    icon: 'pipeline',
    parent: 'pipeline',
  },
  stage_simulate: {
    id: 'stage_simulate',
    label: 'Simulate',
    short: 'Simulate',
    layer: 'pipeline',
    icon: 'pipeline',
    parent: 'pipeline',
  },
  stage_evaluate: {
    id: 'stage_evaluate',
    label: 'Evaluate',
    short: 'Evaluate',
    layer: 'pipeline',
    icon: 'pipeline',
    parent: 'pipeline',
  },
  stage_finalize: {
    id: 'stage_finalize',
    label: 'Finalize',
    short: 'Finalize',
    layer: 'pipeline',
    icon: 'pipeline',
    parent: 'pipeline',
  },
  llm_gateway: {
    id: 'llm_gateway',
    label: 'LLM gateway',
    short: 'Gateway',
    layer: 'dependency',
    icon: 'llm',
  },
  llm_primary: {
    id: 'llm_primary',
    label: 'Primary OpenAI',
    short: 'Primary',
    layer: 'dependency',
    icon: 'llm',
    parent: 'llm_gateway',
  },
  llm_fallback: {
    id: 'llm_fallback',
    label: 'Secondary model',
    short: 'Fallback',
    layer: 'dependency',
    icon: 'llm',
    parent: 'llm_gateway',
  },
  tavily: { id: 'tavily', label: 'Tavily retrieval', short: 'Tavily', layer: 'dependency', icon: 'search' },
  linear_mcp: { id: 'linear_mcp', label: 'Linear MCP', short: 'MCP', layer: 'dependency', icon: 'mcp' },
  circuit: {
    id: 'circuit',
    label: 'Circuit breakers',
    short: 'Breakers',
    layer: 'guard',
    icon: 'shield',
  },
  chaos: { id: 'chaos', label: 'Chaos harness', short: 'Chaos', layer: 'guard', icon: 'flask' },
  trace: { id: 'trace', label: 'Decision trace', short: 'Trace', layer: 'surface', icon: 'api' },
};

const LLM_FALLBACK_STAGES: Partial<Record<ResilienceNodeId, NodeStatus>> = {
  stage_enhance: 'fallback',
  stage_perceive: 'fallback',
  stage_infer: 'fallback',
  stage_simulate: 'fallback',
  stage_evaluate: 'fallback',
  stage_finalize: 'ok',
};

export const RESILIENCE_SCENARIOS: ResilienceScenario[] = [
  {
    id: 'healthy',
    label: 'Healthy',
    tagline: 'All providers respond normally',
    judgePitch: 'Baseline: full LLM quality path with live retrieval and complete traces.',
    injectedFault: 'None — production path',
    stillDelivers: 'Full structured decision report with evidence and reflection',
    nodeStatus: {},
    pipelineNote: 'Every stage uses the configured LLM and live Tavily when available.',
  },
  {
    id: 'primary_5xx',
    label: 'LLM 5xx',
    tagline: 'Primary OpenAI hard outage',
    judgePitch: 'We inject HTTP 500 on the primary model. The gateway retries, fails over, then the pipeline degrades stage-by-stage without a 500 to the user.',
    injectedFault: 'FX_CHAOS → llm.primary returns 500',
    stillDelivers: 'Complete trace + recommendation via deterministic fallbacks',
    nodeStatus: {
      llm_primary: 'stress',
      llm_gateway: 'fallback',
      circuit: 'stress',
      chaos: 'stress',
      ...LLM_FALLBACK_STAGES,
      sse: 'fallback',
    },
    pipelineNote: 'Enhance/perceive/infer/simulate/evaluate switch to template providers; user sees degraded SSE warnings.',
  },
  {
    id: 'primary_429',
    label: 'Rate limit',
    tagline: 'Primary returns 429',
    judgePitch: 'Same survival story as 5xx — backoff, failover, then graceful degradation with visible notices.',
    injectedFault: 'FX_CHAOS → llm.primary returns 429',
    stillDelivers: 'Structured report completes; degradations recorded on trace',
    nodeStatus: {
      llm_primary: 'stress',
      llm_gateway: 'fallback',
      circuit: 'stress',
      chaos: 'stress',
      ...LLM_FALLBACK_STAGES,
      sse: 'fallback',
    },
    pipelineNote: 'Retry-after honored on gateway; pipeline never blocks on a single provider blip.',
  },
  {
    id: 'tavily_outage',
    label: 'Tavily down',
    tagline: 'Live web retrieval unavailable',
    judgePitch: 'World evidence disappears — retrieval returns empty facts, breakers record the fault, and the pipeline keeps going.',
    injectedFault: 'FX_CHAOS → Tavily outage',
    stillDelivers: 'Decision report from memory + LLM; no crash',
    nodeStatus: {
      tavily: 'stress',
      stage_retrieve: 'fallback',
      circuit: 'stress',
      chaos: 'stress',
    },
    pipelineNote: 'TavilyGateway returns []; infer/simulate use profile and question text only.',
  },
  {
    id: 'linear_mcp_outage',
    label: 'MCP down',
    tagline: 'Linear MCP unavailable',
    judgePitch: 'Optional assist path fails closed — we probe, degrade, and continue without blocking decisions.',
    injectedFault: 'FX_CHAOS → mcp.linear outage',
    stillDelivers: 'Full pipeline; MCP assist skipped',
    nodeStatus: {
      linear_mcp: 'stress',
      circuit: 'stress',
      chaos: 'stress',
    },
    pipelineNote: 'probe_linear_mcp() records degradation; no user-facing failure.',
  },
  {
    id: 'recovery',
    label: 'Recovery',
    tagline: 'Faults cleared',
    judgePitch: 'After chaos legs, breakers cool down and the next run returns to full quality — MTTR target ~30s in demo config.',
    injectedFault: 'Chaos profiles cleared',
    stillDelivers: 'Healthy path restored',
    nodeStatus: {},
    pipelineNote: 'Circuit half-open probe allows traffic again; chaos harness disarmed in production.',
  },
];

export const JUDGE_STORY_STEPS = [
  {
    step: '01',
    title: 'The promise',
    body: 'A decision agent must finish the job when the world is on fire. We never return a blank screen because OpenAI or Tavily blinked.',
  },
  {
    step: '02',
    title: 'Defense in depth',
    body: 'Four layers: circuit breakers stop hammering sick deps, the LLM gateway retries and fails over, per-stage deterministic fallbacks finish the trace, and SSE + UI tell the user we degraded honestly.',
  },
  {
    step: '03',
    title: 'Proof, not slides',
    body: 'FX_CHAOS injects real faults. make chaos-demo runs six legs — each must PASS with degradations + a complete decision_id. You can replay scenarios in the explorer below.',
  },
  {
    step: '04',
    title: 'Safe to prod',
    body: 'Smoke test uses an isolated temp dir: zero credits, zero thread writes. Slime chat, diary, and shadow flows are untouched.',
  },
] as const;

export function nodeStatusFor(
  scenario: ResilienceScenario,
  nodeId: ResilienceNodeId,
): NodeStatus {
  return scenario.nodeStatus[nodeId] ?? 'ok';
}

export function scenarioById(id: ResilienceScenarioId): ResilienceScenario {
  return RESILIENCE_SCENARIOS.find((s) => s.id === id) ?? RESILIENCE_SCENARIOS[0];
}

export const STAGE_FALLBACK_COPY: Record<string, string> = {
  enhance: 'Use raw user question (no LLM rewrite)',
  perceive: 'Template user-state from profile + text',
  retrieve: 'Skip live web; empty evidence bundle',
  infer: 'Deterministic option templates',
  simulate: 'Heuristic futures per option',
  evaluate: 'Rule-based scoring',
  finalize: 'Recommendation + reflection assembly',
};

export const NODE_DETAIL: Partial<
  Record<
    ResilienceNodeId,
    { healthy: string; onFault: string; implementation: string }
  >
> = {
  llm_gateway: {
    healthy: 'Structured calls with tenacity retry + jitter',
    onFault: 'Fail over to secondary OpenAI-compatible endpoint',
    implementation: 'foresight_x/orchestration/llm_gateway.py',
  },
  llm_primary: {
    healthy: 'Primary model from user settings',
    onFault: '5xx/429/timeout → DependencyDegraded',
    implementation: 'Breaker: openai · Chaos: llm.primary',
  },
  tavily: {
    healthy: 'Live facts for retrieval stage',
    onFault: 'Returns [] · degradation event recorded',
    implementation: 'foresight_x/retrieval/tavily_client.py',
  },
  linear_mcp: {
    healthy: 'Optional Linear assist probe',
    onFault: 'Probe degrades · pipeline continues',
    implementation: 'resilience/runtime.probe_linear_mcp',
  },
  circuit: {
    healthy: 'Sliding window · brownout on p95 latency',
    onFault: 'Open circuit → fast-fail with half-open probe',
    implementation: 'foresight_x/orchestration/circuit_breaker.py',
  },
  chaos: {
    healthy: 'Disarmed in production (FX_CHAOS off)',
    onFault: 'Inject outage/5xx/partial JSON per target',
    implementation: 'foresight_x/orchestration/chaos.py · make chaos-demo',
  },
  sse: {
    healthy: 'Stage progress events',
    onFault: 'event: degraded + DegradedModeBanner in UI',
    implementation: 'iter_pipeline_events · useDecisionReportStream',
  },
  trace: {
    healthy: 'Full provenance on DecisionTrace',
    onFault: 'degradations[] + report_surface.how_answered',
    implementation: 'foresight_x/decision/report_surface.py',
  },
  api: {
    healthy: 'FastAPI routes stream pipeline events to the client',
    onFault: 'Never returns 500 for dependency faults — pipeline absorbs them',
    implementation: 'foresight_x/ui/api_server.py · iter_pipeline_events',
  },
  pipeline: {
    healthy: 'Seven ordered stages with per-stage latency on trace',
    onFault: 'Each stage catches DependencyDegraded and uses deterministic fallback',
    implementation: 'foresight_x/orchestration/pipeline.py',
  },
};

export const SMOKE_TEST_SPEC = {
  title: 'Isolated resilience smoke test',
  purpose:
    'Proves the decision pipeline can still emit a complete trace and recommendation when the LLM client is disabled — without touching production user data.',
  whatWeTest: [
    {
      label: 'Pipeline completion',
      detail:
        'Runs `iter_pipeline_events()` end-to-end with `llm=None`, forcing deterministic fallbacks on LLM-dependent stages.',
    },
    {
      label: 'Structured output',
      detail:
        'Assert `event: complete`, a non-empty `decision_id`, and `recommendation.chosen_option_id` on the returned trace.',
    },
    {
      label: 'Degradation honesty',
      detail:
        'Counts `event: degraded` SSE payloads and `trace.degradations[]` entries — we expect degradations, not silence.',
    },
    {
      label: 'Runtime health',
      detail: 'Returns `resilience_health_report()` snapshot (circuit breakers + provider stats) after the run.',
    },
  ],
  whatWeDoNotTouch: [
    'User chat threads or diary entries',
    'Slime credits / billing ledger',
    'Production `data/` traces (writes only to `data/resilience_smoke_tmp`)',
    'FX_CHAOS injection (smoke uses llm=None, not chaos profiles)',
  ],
  howItRuns: [
    'Reset in-memory resilience counters',
    'Point Settings at temp dir `data/resilience_smoke_tmp`',
    'Seed partial trace from `data/traces/*.json` if present',
    'Resume from stage `finalize` when seed exists (fast path) else full pipeline',
    'Sample question: role-offer decision scenario',
  ],
  passCriteria: [
    'No Python exceptions in `errors[]`',
    '`pass: true` with `chosen_option_id` set',
    'At least one degradation recorded (proves fallback path, not fake success)',
  ],
} as const;
