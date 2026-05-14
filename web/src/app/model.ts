export type AppState = 'empty' | 'loading' | 'result';

export type EvidenceRefType =
  | 'profile'
  | 'past_decision'
  | 'current_constraint'
  | 'memory'
  | 'user_statement'
  | 'world_evidence'
  | 'tradeoff'
  | 'assumption';
export type GroundingStrength = 'strong' | 'mixed' | 'thin';
export type GroundingSignalType = 'user_context' | 'personal_memory' | 'external_evidence' | 'uncertainty';

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

export interface GroundingSignal {
  type: GroundingSignalType;
  label: string;
  text: string;
  strength: GroundingStrength;
}

export interface PrimaryNextAction {
  text: string;
  durationEstimate: string;
  deadline?: string;
}

/** Concise surface mapped from backend `report_surface` or derived client-side for legacy traces. */
export interface ReportSurface {
  groundingNote: string;
  groundingStrength: GroundingStrength;
  groundingSignals: GroundingSignal[];
  howAnswered?: string;
  personalizedReasons: PersonalizedFitReason[];
  futurePaths: FuturePath[];
  keyAssumptions: string[];
  primaryNextAction: PrimaryNextAction;
}

export type SlimeColorTheme = 'aurora' | 'violet' | 'mint' | 'sunset' | 'lime' | 'silver' | 'custom';
export type SlimePersonality = 'calm' | 'direct' | 'encouraging' | 'analytical' | 'playful' | 'cautious';
export type SlimeShape = 'classic' | 'orb' | 'robot' | 'crystal' | 'ghost';
export type SlimeAccessory = 'none' | 'glasses' | 'halo' | 'antenna' | 'scarf' | 'spark';
export type SlimeMotion = 'subtle' | 'normal' | 'expressive';

export type SlimePersonalityPreset =
  | 'calm_advisor'
  | 'direct_strategist'
  | 'warm_friend'
  | 'playful_pet'
  | 'analytical_coach'
  | 'hype_buddy'
  | 'gentle_companion'
  | 'minimalist_assistant';

export type SlimePersonaTone =
  | 'calm'
  | 'warm'
  | 'direct'
  | 'playful'
  | 'analytical'
  | 'encouraging'
  | 'witty'
  | 'concise';

export type SlimeReplyLength = 'short' | 'balanced' | 'detailed';

export type SlimeCompanionRelationship =
  | 'helper'
  | 'pet'
  | 'companion'
  | 'coach'
  | 'tiny_robot_slime_assistant'
  | 'helper_pet_companion'
  | 'assistant';

/** Canonical slime identity snapshot from GET /api/profile/slime (optional on older payloads). */
export interface SlimeSelfModelView {
  name: string;
  nameSafeForUi: boolean;
  spokenName: string;
  relationshipToUser: string;
  abilities: string[];
  limitations: string[];
  boundaries: string[];
}

export interface SlimePersona {
  userNickname?: string | null;
  companionRelationship?: SlimeCompanionRelationship;
  roleIdentity: string;
  personalityPreset: SlimePersonalityPreset;
  tone: SlimePersonaTone;
  warmth: 0 | 1 | 2 | 3;
  humor: 0 | 1 | 2 | 3;
  directness: 0 | 1 | 2 | 3;
  replyLength: SlimeReplyLength;
  catchphrases: string[];
  /** Style boundaries — max ~5 lines on save (server validates). */
  donts: string[];
  updated_at?: string;
}

export interface SlimeProfile {
  name: string;
  colorTheme: SlimeColorTheme;
  customColors?: {
    primary: string;
    secondary: string;
    glow: string;
  };
  personality: SlimePersonality;
  shape: SlimeShape;
  accessory: SlimeAccessory;
  motion: SlimeMotion;
  voice?: {
    enabled: boolean;
    rate: number;
    pitch: number;
    preferredVoiceName?: string;
  };
  persona?: SlimePersona | null;
  updated_at: string;
  slimeSelfModel?: SlimeSelfModelView | null;
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
