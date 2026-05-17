export type DegradedNotice = {
  id: string;
  message: string;
  stage?: string;
  fallbackPath?: string;
};

function noticeKey(message: string, stage?: string, fallbackPath?: string): string {
  return `${stage || ''}|${fallbackPath || ''}|${message}`;
}

const SOFT_STAGE_FALLBACKS = new Set([
  'enhance',
  'perceive',
  'retrieve',
  'infer',
  'simulate',
  'evaluate',
  'finalize',
  'reflect',
]);

const RECOVERED_PROVIDER_ERROR_KINDS = new Set([
  'validationerror',
  'jsondecodeerror',
  'rate_limit_exceeded',
  'ratelimiterror',
  'apiconnectionerror',
  'timeouterror',
  'readtimeout',
]);

const HARD_ERROR_KINDS = new Set([
  'circuit_open',
  'outage',
  'timeout',
  '5xx',
  'chaos_outage',
  'chaos_timeout',
  'chaos_5xx',
]);

/** Raw degradation row from API/trace — hide routine fallbacks and recovered provider errors. */
export function isUserVisibleDegradation(raw: Record<string, unknown>): boolean {
  const kind = String(raw.error_kind || '').trim().toLowerCase();
  const stage = String(raw.stage || '').trim().toLowerCase();
  const reason = String(raw.reason || raw.message || '').trim().toLowerCase();

  if (HARD_ERROR_KINDS.has(kind)) return true;
  if (reason.includes('circuit') && reason.includes('open')) return true;
  if (reason.includes('outage') || reason.includes('chaos injection')) return true;

  if (kind === 'llm_unavailable' && SOFT_STAGE_FALLBACKS.has(stage)) return false;
  if (stage === 'llm_gateway' && reason.includes('failing over')) return false;
  if (stage === 'infra_probe') return false;
  if (stage === 'runtime' && RECOVERED_PROVIDER_ERROR_KINDS.has(kind)) return false;
  if (stage === 'runtime' && kind === 'brownout') return false;
  return false;
}

export function formatDegradedPayload(raw: Record<string, unknown>): DegradedNotice {
  const reason = String(raw.reason || raw.message || 'Running in degraded mode').trim();
  const stage = String(raw.stage || '').trim();
  const fallbackPath = String(raw.fallback_path || raw.fallbackPath || '').trim();
  const detail = fallbackPath ? `${reason} (${fallbackPath})` : reason;
  const message = stage ? `[${stage}] ${detail}` : detail;
  return {
    id: noticeKey(message, stage, fallbackPath),
    message,
    stage: stage || undefined,
    fallbackPath: fallbackPath || undefined,
  };
}

export function mergeDegradedNotices(
  prev: DegradedNotice[],
  incoming: DegradedNotice[],
  max = 6,
): DegradedNotice[] {
  const seen = new Set(prev.map((n) => n.id));
  const out = [...prev];
  for (const n of incoming) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out.slice(-max);
}

export function noticesFromTrace(trace: Record<string, unknown> | null | undefined): DegradedNotice[] {
  if (!trace) return [];
  const rows = trace.degradations;
  if (!Array.isArray(rows)) return [];
  const out: DegradedNotice[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const raw = row as Record<string, unknown>;
    if (!isUserVisibleDegradation(raw)) continue;
    out.push(formatDegradedPayload(raw));
  }
  return mergeDegradedNotices([], out);
}

export function noticeMessages(notices: DegradedNotice[]): string[] {
  return notices.map((n) => n.message);
}

export function shouldShowDegradedModeBanner(
  notices: DegradedNotice[],
  opts?: { streamError?: boolean },
): boolean {
  if (opts?.streamError) return true;
  return notices.length > 0;
}
