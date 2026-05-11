import { apiFetch } from '../../utils/apiFetch';
import type { SlimeCostPreview, SlimeCreditFeature, SlimeModelRow, SlimeModelsApiResponse } from './types';

export async function fetchSlimeModelCatalog(): Promise<SlimeModelsApiResponse> {
  const res = await apiFetch('/api/models');
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as SlimeModelsApiResponse;
}

export async function fetchCostPreview(
  feature: SlimeCreditFeature,
  modelId: string | null | undefined,
): Promise<SlimeCostPreview> {
  const q = new URLSearchParams({ feature });
  if (modelId) q.set('model_id', modelId);
  const res = await apiFetch(`/api/models/cost-preview?${q.toString()}`);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as SlimeCostPreview;
}

export async function patchDefaultModelOption(defaultModelOptionId: string): Promise<void> {
  const res = await apiFetch('/api/profile/model-preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ default_model_option_id: defaultModelOptionId }),
  });
  if (!res.ok) throw new Error(await res.text());
}

/** Pick lowest ``credit_multiplier`` tier for “try cheaper” hints. */
export function cheapestEnabledModel(models: SlimeModelRow[]): SlimeModelRow | null {
  if (!models.length) return null;
  return [...models].sort((a, b) => (a.credit_multiplier ?? 1) - (b.credit_multiplier ?? 1))[0] ?? null;
}

export async function buildCheaperModelHint(
  feature: SlimeCreditFeature,
  currentModelId: string,
  models: SlimeModelRow[],
): Promise<string | undefined> {
  const cheap = cheapestEnabledModel(models);
  if (!cheap || cheap.id === currentModelId) return undefined;
  try {
    const prev = await fetchCostPreview(feature, cheap.id);
    return `${cheap.display_name} would use about ${prev.final_cost} credits for this action (estimate).`;
  } catch {
    return `Try ${cheap.display_name} for a lower credit cost.`;
  }
}
