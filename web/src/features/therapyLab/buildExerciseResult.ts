import { buildSafeMemoryCandidate } from './memoryCandidate';
import type {
  TherapyExerciseResult,
  TherapyExerciseStatus,
  TherapyExerciseType,
  TherapyNextAction,
} from './types';

export function buildExerciseResult(input: {
  exerciseType: TherapyExerciseType;
  startedAt: string;
  status: TherapyExerciseStatus;
  beforeIntensity?: number;
  afterIntensity?: number;
  resultSummary: string;
  nextActions?: TherapyNextAction[];
  payload?: Record<string, unknown>;
  memoryOpts?: { mood?: string; goal?: string; intensity?: number };
}): TherapyExerciseResult {
  const endedAt = new Date().toISOString();
  return {
    exerciseType: input.exerciseType,
    source: 'therapy_lab',
    startedAt: input.startedAt,
    endedAt,
    status: input.status,
    beforeIntensity: input.beforeIntensity,
    afterIntensity: input.afterIntensity,
    resultSummary: input.resultSummary,
    memoryCandidate: buildSafeMemoryCandidate(input.exerciseType, input.resultSummary, {
      ...input.memoryOpts,
      intensity: input.afterIntensity ?? input.beforeIntensity,
    }),
    nextActions: input.nextActions ?? [],
    payload: input.payload,
  };
}
