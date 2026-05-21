/** Three-letter dock badge for slime model / speed tiers (buddy voice bar). */
const SLIME_MODEL_DOCK_ABBREV: Record<string, string> = {
  little: 'LIT',
  swift: 'SWF',
  balanced: 'BAL',
  deep: 'DEE',
  slime_55: '5.5',
  research: 'RES',
};

export function slimeModelDockAbbrev(modelId: string, displayName?: string): string {
  const id = modelId.trim().toLowerCase();
  const mapped = SLIME_MODEL_DOCK_ABBREV[id];
  if (mapped) return mapped;

  const word = (displayName ?? modelId).trim().split(/\s+/)[0] ?? '';
  const letters = word.replace(/[^A-Za-z0-9.]/g, '');
  if (letters.length >= 3) return letters.slice(0, 3).toUpperCase();
  if (letters.length > 0) return letters.toUpperCase().padEnd(3, letters[letters.length - 1] ?? 'X');
  return modelId.slice(0, 3).toUpperCase() || 'MDL';
}
