import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { apiFetch } from '../../utils/apiFetch';
import type { SlimeModelRow, SlimeModelsApiResponse } from './types';
import { fetchSlimeModelCatalog } from './slimeModelsApi';
import { SLIME_LEGENDARY_MODEL_ID, useSlimeLegendaryMode } from './legendaryMode';

type CatalogState = {
  rawModels: SlimeModelRow[];
  serverDefaultModel: string;
  profileDefaultModel: string;
  selectorEnabled: boolean;
  loading: boolean;
  error: string | null;
};

const empty: CatalogState = {
  rawModels: [],
  serverDefaultModel: 'little',
  profileDefaultModel: '',
  selectorEnabled: false,
  loading: true,
  error: null,
};

/**
 * Loads ``GET /api/models`` and merges ``default_model_option_id`` from ``GET /api/profile`` when valid.
 * Hides the easter-egg ``slime_55`` (“5.5”) row unless legendary mode is on (see ``legendaryMode.ts``).
 */
export function useSlimeModelCatalog() {
  const { session } = useAuth();
  const [state, setState] = useState<CatalogState>(empty);
  const legendary = useSlimeLegendaryMode();

  const models = useMemo(() => {
    if (legendary) return state.rawModels;
    return state.rawModels.filter((m) => m.id !== SLIME_LEGENDARY_MODEL_ID);
  }, [state.rawModels, legendary]);

  const defaultModel = useMemo(() => {
    const ids = new Set(models.map((m) => m.id));
    const pd = (state.profileDefaultModel || '').trim();
    if (pd && ids.has(pd)) return pd;
    const sd = (state.serverDefaultModel || '').trim();
    if (sd && ids.has(sd)) return sd;
    return models.find((m) => m.id === 'little')?.id || models[0]?.id || 'little';
  }, [models, state.profileDefaultModel, state.serverDefaultModel]);

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [catRes, profRes] = await Promise.all([fetchSlimeModelCatalog(), apiFetch('/api/profile')]);
      let profileDefault = '';
      if (profRes.ok) {
        const p = (await profRes.json()) as { default_model_option_id?: string };
        profileDefault = (p.default_model_option_id || '').trim();
      }
      const cat = catRes as SlimeModelsApiResponse;
      setState({
        rawModels: cat.models,
        serverDefaultModel: cat.default_model || 'little',
        profileDefaultModel: profileDefault,
        selectorEnabled: cat.selector_enabled !== false && cat.models.length > 0,
        loading: false,
        error: null,
      });
    } catch (e) {
      setState({
        rawModels: [],
        serverDefaultModel: 'little',
        profileDefaultModel: '',
        selectorEnabled: false,
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to load models',
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, session?.user?.id]);

  const ready = useMemo(() => !state.loading, [state.loading]);

  return {
    models,
    defaultModel,
    selectorEnabled: state.selectorEnabled && models.length > 0,
    loading: state.loading,
    error: state.error,
    refresh,
    ready,
  };
}
