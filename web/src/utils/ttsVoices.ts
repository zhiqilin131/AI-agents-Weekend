export const OPENAI_TTS_VOICES = [
  { id: 'onyx', label: 'Onyx - deeper' },
  { id: 'echo', label: 'Echo - clear' },
  { id: 'fable', label: 'Fable - warm' },
  { id: 'alloy', label: 'Alloy - neutral' },
  { id: 'nova', label: 'Nova - lively' },
  { id: 'shimmer', label: 'Shimmer - airy' },
] as const;

const TTS_VOICE_IDS = new Set(OPENAI_TTS_VOICES.map((v) => v.id));

const LEGACY_BROWSER_VOICE_ALIASES: Array<[string, string]> = [
  ['eddy', 'onyx'],
  ['alex', 'echo'],
  ['daniel', 'onyx'],
  ['fred', 'echo'],
  ['tom', 'onyx'],
  ['samantha', 'nova'],
  ['victoria', 'nova'],
  ['ash', 'echo'],
  ['coral', 'nova'],
  ['sage', 'shimmer'],
  ['karen', 'shimmer'],
  ['susan', 'shimmer'],
];

export function normalizeTtsVoiceName(raw: string | null | undefined): string | undefined {
  const low = String(raw || '').trim().toLowerCase();
  if (!low) return undefined;
  if (TTS_VOICE_IDS.has(low)) return low;
  const hit = LEGACY_BROWSER_VOICE_ALIASES.find(([needle]) => low.includes(needle));
  return hit?.[1];
}
