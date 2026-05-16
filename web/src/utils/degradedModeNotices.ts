export type DegradedNotice = {
  id: string;
  message: string;
  stage?: string;
  fallbackPath?: string;
};

function noticeKey(message: string, stage?: string, fallbackPath?: string): string {
  return `${stage || ''}|${fallbackPath || ''}|${message}`;
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
    out.push(formatDegradedPayload(row as Record<string, unknown>));
  }
  return mergeDegradedNotices([], out);
}

export function noticeMessages(notices: DegradedNotice[]): string[] {
  return notices.map((n) => n.message);
}
