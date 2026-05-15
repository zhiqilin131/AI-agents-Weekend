export type ResilienceLevel = 'green' | 'yellow' | 'red';

export type ResilienceHealth = {
  status?: string;
  report_card?: {
    fallback_mode_rate?: number;
    fallback_completion_rate?: number;
  };
  runtime?: {
    providers?: Record<string, Record<string, unknown>>;
    circuit_breakers?: Record<string, { state?: string; failures?: number; open_until_epoch?: number }>;
    chaos_modes?: Record<string, string>;
  };
};

export type ResilienceDegradationNotice = {
  id: string;
  at: string;
  stage: string;
  component: string;
  message: string;
  retryable: boolean;
  errorKind?: string;
};

export const RESILIENCE_STAGE_LABEL: Record<string, string> = {
  enhance: 'Clarify',
  perceive: 'Perception',
  retrieve: 'Evidence',
  infer: 'Options',
  simulate: 'Simulation',
  evaluate: 'Scoring',
  finalize: 'Reflection',
  infra_probe: 'Infrastructure',
  network: 'Connection',
};

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function userFacingDegradationMessage(raw: Record<string, unknown>, fallback?: string): string {
  const component = text(raw.component).toLowerCase();
  const stage = text(raw.stage).toLowerCase();
  const reason = text(raw.reason || fallback).toLowerCase();

  if (component.includes('tavily') || component.includes('web') || component.includes('search')) {
    return 'Live web disabled — using cached evidence';
  }
  if (
    component.includes('openai') ||
    component.includes('llm') ||
    reason.includes('backup') ||
    reason.includes('fallback') ||
    reason.includes('claude')
  ) {
    return reason.includes('reflection') || stage === 'finalize'
      ? 'Reflection skipped — LLM provider unhealthy'
      : 'Switched to backup model';
  }
  if (stage === 'finalize' || reason.includes('reflection')) {
    return 'Reflection skipped — LLM provider unhealthy';
  }
  return text(raw.reason || fallback) || 'Running in degraded mode';
}

export function noticeFromDegradation(
  degraded: Record<string, unknown>,
  fallbackMessage?: string,
): ResilienceDegradationNotice {
  const at = text(degraded.at) || new Date().toISOString();
  const stage = text(degraded.stage) || text(degraded.component) || 'runtime';
  const component = text(degraded.component) || stage || 'runtime';
  const message = userFacingDegradationMessage(degraded, fallbackMessage);
  return {
    id: `${stage}:${component}:${message}`,
    at,
    stage,
    component,
    message,
    retryable: degraded.retryable !== false,
    errorKind: text(degraded.error_kind) || undefined,
  };
}

export function networkReconnectNotice(stage?: string): ResilienceDegradationNotice {
  const st = stage || 'network';
  return {
    id: `${st}:network:reconnect`,
    at: new Date().toISOString(),
    stage: st,
    component: 'network',
    message: 'Connection dropped — reconnecting to the same decision',
    retryable: true,
    errorKind: 'transport',
  };
}

export function mergeDegradationNotice(
  notices: ResilienceDegradationNotice[],
  notice: ResilienceDegradationNotice,
  max = 5,
): ResilienceDegradationNotice[] {
  const next = notices.filter((n) => n.id !== notice.id);
  return [...next, notice].slice(-max);
}

export function resilienceLevel(health: ResilienceHealth | null, failed = false): ResilienceLevel {
  if (failed || !health) return 'red';
  const runtime = health.runtime || {};
  const breakers = runtime.circuit_breakers || {};
  if (Object.values(breakers).some((b) => String(b?.state || '').toLowerCase() === 'open')) return 'red';
  const chaos = runtime.chaos_modes || {};
  if (Object.values(chaos).some((m) => m && m !== 'off')) return 'yellow';
  if (Object.values(breakers).some((b) => String(b?.state || '').toLowerCase() === 'half_open')) return 'yellow';
  const fallbackRate = Number(health.report_card?.fallback_mode_rate ?? 0);
  if (fallbackRate > 0) return 'yellow';
  const providers = runtime.providers || {};
  if (Object.values(providers).some((p) => Number(p?.error_total ?? 0) > 0)) return 'yellow';
  return 'green';
}

export function canRetryDegradation(
  notice: ResilienceDegradationNotice,
  health: ResilienceHealth | null,
): boolean {
  if (!notice.retryable || !health) return false;
  const breakers = health.runtime?.circuit_breakers || {};
  const candidates = [notice.component, notice.stage]
    .map((s) => s.toLowerCase())
    .filter(Boolean);
  const matched = Object.entries(breakers).find(([name]) =>
    candidates.some((c) => name.toLowerCase().includes(c) || c.includes(name.toLowerCase())),
  );
  if (!matched) return resilienceLevel(health) !== 'red';
  const state = String(matched[1]?.state || '').toLowerCase();
  return state === 'closed' || state === 'half_open';
}
