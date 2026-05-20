type UiCacheEnvelope<T> = {
  expiresAt: number;
  value: T;
};

const memoryCache = new Map<string, UiCacheEnvelope<unknown>>();
const inflightLoads = new Map<string, Promise<unknown>>();
const STORAGE_PREFIX = 'fx-ui-cache:';

function nowMs(): number {
  return Date.now();
}

function toStorageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

export const UI_CACHE_TTL = {
  shadowThreadsMs: 90_000,
  shadowThreadDetailMs: 300_000,
  historyTracesMs: 90_000,
} as const;

export function buildShadowThreadsCacheKey(userId?: string | null): string {
  return `shadow:threads:${userId || 'anon'}`;
}

export function buildShadowThreadDetailCacheKey(userId: string | null | undefined, threadId: string): string {
  return `shadow:thread:${userId || 'anon'}:${threadId}`;
}

export function buildHistoryTracesCacheKey(userId?: string | null): string {
  return `history:traces:${userId || 'anon'}`;
}

export function readUiDataCache<T>(key: string): T | null {
  const mem = memoryCache.get(key);
  if (mem && mem.expiresAt > nowMs()) {
    return mem.value as T;
  }
  if (mem) {
    memoryCache.delete(key);
  }
  try {
    const raw = sessionStorage.getItem(toStorageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UiCacheEnvelope<T>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.expiresAt !== 'number') {
      sessionStorage.removeItem(toStorageKey(key));
      return null;
    }
    if (parsed.expiresAt <= nowMs()) {
      sessionStorage.removeItem(toStorageKey(key));
      return null;
    }
    memoryCache.set(key, parsed as UiCacheEnvelope<unknown>);
    return parsed.value;
  } catch {
    return null;
  }
}

export function writeUiDataCache<T>(key: string, value: T, ttlMs: number): void {
  const envelope: UiCacheEnvelope<T> = {
    expiresAt: nowMs() + Math.max(0, ttlMs),
    value,
  };
  memoryCache.set(key, envelope as UiCacheEnvelope<unknown>);
  try {
    sessionStorage.setItem(toStorageKey(key), JSON.stringify(envelope));
  } catch {
    /* ignore quota/storage errors */
  }
}

export async function prefetchUiDataCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T | null> {
  const cached = readUiDataCache<T>(key);
  if (cached !== null) return cached;
  const existing = inflightLoads.get(key) as Promise<T> | undefined;
  if (existing) {
    try {
      return await existing;
    } catch {
      return null;
    }
  }
  const loading = (async () => {
    const value = await loader();
    writeUiDataCache(key, value, ttlMs);
    return value;
  })();
  inflightLoads.set(key, loading);
  try {
    return await loading;
  } catch {
    return null;
  } finally {
    inflightLoads.delete(key);
  }
}
