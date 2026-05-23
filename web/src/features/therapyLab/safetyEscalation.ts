/** Mirrors backend `is_safety_escalation_message` for therapy lab client-side checks. */

export const SAFETY_ESCALATION_REPLY =
  "I'm really glad you told me. This sounds serious enough that I shouldn't treat it like a normal exercise. " +
  'Are you in immediate danger right now, or do you feel like you might hurt yourself or someone else? ' +
  'If yes, please contact emergency services now. If you\'re in the U.S., you can call or text 988 for ' +
  'immediate crisis support. If there\'s someone you trust nearby, please reach out to them or stay near ' +
  'them while we slow this down.';

function breathingIsPanicNotMedical(low: string): boolean {
  if (!/\b(can't breathe|cannot breathe|cant breathe|hard to breathe)\b/.test(low)) return false;
  if (
    /\b(chest pain|heart attack|stroke|choking|turning blue|lips blue|allergic reaction|anaphylaxis|medical emergency)\b/.test(
      low,
    )
  ) {
    return false;
  }
  return /\b(panic|panicking|anxiety|anxious|freaking out|spiral|spiraling|attack|hyperventilat|dissociat)\b/.test(
    low,
  );
}

export function isSafetyEscalationMessage(text: string): boolean {
  const low = (text || '').toLowerCase();
  if (!low.trim()) return false;
  if (breathingIsPanicNotMedical(low)) return false;

  const patterns = [
    /\b(kill myself|killing myself|end my life|suicide|suicidal)\b/,
    /\b(hurt myself|harm myself|self[- ]?harm|cut myself)\b/,
    /\b(want to die|wish i (was|were) dead|no reason to live|better off dead)\b/,
    /\b(disappear forever|don't want to (be here|live)|cant go on)\b/,
    /\b(hurt (him|her|them|someone)|kill (him|her|them|someone))\b/,
    /\b(overdose|od[' ]?d|took too many pills)\b/,
    /\b(hallucinat|hearing voices|seeing things|psychosis|losing touch with reality)\b/,
    /\b(medical emergency|chest pain|stroke|heart attack)\b/,
    /\b(domestic violence|sexual assault|rape|being abused|abusive partner)\b/,
    /\b(eating disorder).{0,40}\b(faint|hospital|can't eat|starving)\b/,
    /\b(i want to hurt myself)\b/,
    /\b(can't breathe|cannot breathe|cant breathe)\b/,
  ];
  return patterns.some((p) => p.test(low));
}

export function scanTextFieldsForSafety(fields: Array<string | undefined | null>): boolean {
  return fields.some((f) => isSafetyEscalationMessage(f ?? ''));
}
