/** Mirrors backend ``CreditFeature`` for cost preview + request tagging. */
export type SlimeCreditFeature =
  | 'shadow_chat'
  | 'clarify_gate'
  | 'slime_chat'
  | 'slime_voice'
  | 'decision_report'
  | 'diary_generate'
  | 'memory_import'
  | 'calendar_agent'
  | 'resource_search'
  | 'report_revision'
  | 'task_decomposition'
  | 'outcome_reflection'
  | 'tts'
  | 'asr';

export type SlimeModelRow = {
  id: string;
  display_name: string;
  description: string;
  best_for: string[];
  tier: string;
  speed: string;
  quality: string;
  credit_multiplier: number;
  enabled: boolean;
  badge?: string;
  supports_tools?: boolean;
  supports_vision?: boolean;
  supports_audio?: boolean;
  /** OpenAI model id for this tier (from server env). */
  engine?: string;
};

export type SlimeModelsApiResponse = {
  models: SlimeModelRow[];
  default_model: string;
  selector_enabled?: boolean;
};

export type SlimeCostPreview = {
  feature: string;
  model_id: string;
  base_cost: number;
  model_multiplier: number;
  final_cost: number;
  balance: number | null;
  allowed: boolean;
};
