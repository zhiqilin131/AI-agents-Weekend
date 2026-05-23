import type { TherapyExerciseType } from './types';

const SENSITIVE_RE =
  /\b(suicide|suicidal|self[- ]?harm|kill myself|overdose|rape|abuse|cut myself|988)\b/i;

function redactSensitive(text: string): string {
  return text.replace(SENSITIVE_RE, '[sensitive]').slice(0, 120);
}

export function buildSafeMemoryCandidate(
  exerciseType: TherapyExerciseType,
  summary: string,
  opts?: { mood?: string; goal?: string; intensity?: number },
): string {
  const mood = opts?.mood ? redactSensitive(opts.mood) : '';
  const goal = opts?.goal ? redactSensitive(opts.goal) : '';
  const intensity =
    typeof opts?.intensity === 'number' ? ` intensity ~${Math.round(opts.intensity)}/10` : '';
  const base = redactSensitive(summary).trim() || 'Completed a brief wellbeing exercise.';
  switch (exerciseType) {
    case 'emotion_check_in':
      return `[Rimumu check-in] ${mood || 'Mood noted'}${goal ? ` · goal: ${goal}` : ''}${intensity}. ${base}`;
    case 'breathing_guide':
      return `[Rimumu exercise] Breathing practice${intensity}. ${base}`;
    case 'grounding_54321':
      return `[Rimumu exercise] Grounding exercise${intensity}. ${base}`;
    case 'cbt_thought_reframe':
      return `[Rimumu exercise] Thought reframe (no clinical labels). ${base}`;
    case 'micro_action_plan':
      return `[Rimumu exercise] Micro action chosen. ${base}`;
    default:
      return `[Rimumu exercise] ${base}`;
  }
}
