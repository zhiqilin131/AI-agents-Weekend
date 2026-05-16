import { apiFetch } from './apiFetch';
import { normalizeTtsVoiceName } from './ttsVoices';

export type SlimeTtsFetchErrorKind = 'credits' | 'not_configured' | 'provider' | 'network';

export type SlimeTtsFetchResult =
  | { ok: true; blob: Blob }
  | { ok: false; kind: SlimeTtsFetchErrorKind; message: string };

export type SlimeTtsVoiceOpts = {
  preferredVoiceName?: string | null;
  rate?: number | null;
  modelOptionId?: string | null;
};

async function parseApiErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { detail?: unknown; message?: unknown };
    if (typeof j.message === 'string' && j.message.trim()) return j.message.trim();
    if (typeof j.detail === 'string' && j.detail.trim()) return j.detail.trim();
    if (Array.isArray(j.detail)) {
      const parts = j.detail
        .map((d) => {
          if (typeof d === 'string') return d;
          if (d && typeof d === 'object' && 'msg' in d) return String((d as { msg?: string }).msg || '');
          return '';
        })
        .filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
  } catch {
    /* plain text body */
  }
  const trimmed = text.trim();
  if (trimmed) return trimmed.length > 220 ? `${trimmed.slice(0, 220)}…` : trimmed;
  return `Voice request failed (${res.status})`;
}

/** Server TTS for Buddy + report read-aloud. */
export async function fetchSlimeTtsBlob(
  text: string,
  requestIdPrefix: string,
  voiceOpts?: SlimeTtsVoiceOpts,
): Promise<SlimeTtsFetchResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, kind: 'network', message: 'Nothing to read aloud.' };
  }
  const requestId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${requestIdPrefix}-${Date.now()}`;
  const ttsVoice = normalizeTtsVoiceName(voiceOpts?.preferredVoiceName);
  let res: Response;
  try {
    res = await apiFetch('/api/slime/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Credit-Request-Id': requestId,
      },
      body: JSON.stringify({
        text: trimmed,
        ...(ttsVoice ? { voice: ttsVoice } : {}),
        ...(typeof voiceOpts?.rate === 'number' ? { speed: voiceOpts.rate } : {}),
        ...(voiceOpts?.modelOptionId ? { model_option_id: voiceOpts.modelOptionId } : {}),
      }),
    });
  } catch {
    return {
      ok: false,
      kind: 'network',
      message: 'Could not reach the voice API. Check that the backend is running.',
    };
  }
  if (res.status === 402) {
    let message = 'You need more Slime Credits for voice playback.';
    try {
      const j = (await res.json()) as { message?: string };
      if (typeof j.message === 'string' && j.message.trim()) message = j.message.trim();
    } catch {
      /* ignore */
    }
    return { ok: false, kind: 'credits', message };
  }
  if (res.status === 503) {
    return {
      ok: false,
      kind: 'not_configured',
      message: 'Voice needs OPENAI_API_KEY on the API server (same key as chat).',
    };
  }
  if (!res.ok) {
    const detail = await parseApiErrorMessage(res);
    return { ok: false, kind: 'provider', message: detail };
  }
  const blob = await res.blob();
  if (!blob.size) {
    return { ok: false, kind: 'provider', message: 'Voice API returned empty audio.' };
  }
  return { ok: true, blob };
}

export function slimeTtsHintForFetchError(kind: SlimeTtsFetchErrorKind, message: string): string {
  if (kind === 'credits') {
    return message.includes('Credit') ? message : `Cloud voice needs more Slime Credits. ${message}`;
  }
  if (kind === 'not_configured') return message;
  if (kind === 'provider') {
    return message.length > 120 ? `${message.slice(0, 120)}…` : message;
  }
  return message;
}
