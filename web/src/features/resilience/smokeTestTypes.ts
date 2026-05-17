export type SmokeAssertion = {
  id?: string;
  label?: string;
  pass?: boolean;
  detail?: string;
};

export type SmokePhase = {
  id?: string;
  label?: string;
  status?: string;
  detail?: string;
};

export type SmokeEventLogEntry = {
  t_ms?: number;
  type?: string;
  stage?: string;
  summary?: string;
};

export type SmokeDegradationRow = {
  provider?: string;
  stage?: string;
  reason?: string;
  fallback?: string;
};

export type SmokeRun = {
  pass?: boolean;
  elapsed_ms?: number;
  started_at?: string;
  degradation_count?: number;
  degraded_sse_count?: number;
  decision_id?: string | null;
  chosen_option_id?: string | null;
  errors?: string[];
  note?: string;
  isolated?: boolean;
  stability_score?: number;
  mode?: string;
  question?: string;
  llm_mode?: string;
  seed_file?: string | null;
  phases?: SmokePhase[];
  event_log?: SmokeEventLogEntry[];
  pipeline_stages_seen?: string[];
  pipeline_stages_expected?: string[];
  degradations_detail?: SmokeDegradationRow[];
  assertions?: SmokeAssertion[];
  health?: {
    circuit_breakers?: Record<string, unknown>;
    chaos_modes?: Record<string, string>;
  };
};

export type SmokeStreamPhase = SmokePhase & { type?: 'phase' };
export type SmokeStreamPipeline = {
  type: 'pipeline';
  t_ms?: number;
  event?: string;
  stage?: string;
  summary?: string;
};
