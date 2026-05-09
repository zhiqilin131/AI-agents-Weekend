export type AppState = 'empty' | 'loading' | 'result';

export type EvidenceRefType =
  | 'profile'
  | 'past_decision'
  | 'current_constraint'
  | 'memory'
  | 'user_statement';

export interface EvidenceReference {
  type: EvidenceRefType;
  id?: string;
  text: string;
  confidence?: number;
}

export interface FuturePath {
  pathType: 'expected' | 'friction' | 'pivot';
  title: string;
  summary: string;
  triggerConditions: string[];
  watchSignals: string[];
  recommendedAction: string;
  basedOn: EvidenceReference[];
}

export interface PersonalizedFitReason {
  text: string;
  basedOn: EvidenceReference[];
}

export interface PrimaryNextAction {
  text: string;
  durationEstimate: string;
  deadline?: string;
}

/** Concise surface mapped from backend `report_surface` or derived client-side for legacy traces. */
export interface ReportSurface {
  groundingNote: string;
  personalizedReasons: PersonalizedFitReason[];
  futurePaths: FuturePath[];
  keyAssumptions: string[];
  primaryNextAction: PrimaryNextAction;
}

/** Slime “resource drops” — URLs only from Tavily/curated; internal rows may omit url. */
export type ResourceDropActionType =
  | 'website'
  | 'official_page'
  | 'tool'
  | 'template'
  | 'calendar'
  | 'internal_action'
  | 'search_result';

export interface ResourceDrop {
  id: string;
  title: string;
  description: string;
  url: string | null;
  action_type: ResourceDropActionType;
  source: 'tavily' | 'curated' | 'internal';
  relevance_reason: string;
  confidence: number;
  domain: string | null;
}

export const RESOURCE_DROP_CALENDAR_ID = 'internal_execution_calendar';

export interface DecisionReport {
  /** User's exact text before LLM clarification (if any). */
  originalInput?: string;
  /** Text used for analysis (may match original). */
  enhancedInput?: string;
  situation: string;
  insights: {
    decisionType?: string;
    timePressure?: string;
    stress?: string;
    biasRisks?: string[];
    memoryPatterns?: string[];
  };
  options: Array<{
    id: string;
    name: string;
    description: string;
    keyAssumptions: string[];
    costOfReversal: string;
    /** 1 = strongest by model scores (optional during streaming partials) */
    importanceRank?: number;
    importanceTier?: 'high' | 'medium' | 'low';
    isRecommended?: boolean;
  }>;
  tradeoffs?: {
    headers: string[];
    headerHints: Record<string, string>;
    rows: Array<{
      optionId: string;
      optionName: string;
      scores: Record<string, number | string>;
    }>;
  };
  recommendation: {
    reasoning: string;
    /** Backend option_id for the recommendation */
    chosenOption: string;
    /** Human-readable option name when available */
    chosenOptionName?: string;
  };
  actions: Array<{
    text: string;
    deadline?: string;
  }>;
  reflection: {
    possibleErrors?: string[];
    uncertaintySources?: string[];
    informationGaps?: string[];
    selfImprovement?: string;
  };
  reportSurface?: ReportSurface;
}
