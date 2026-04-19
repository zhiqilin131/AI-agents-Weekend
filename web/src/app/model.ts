export type AppState = 'empty' | 'loading' | 'result';

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
    chosenOption: string;
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
}
