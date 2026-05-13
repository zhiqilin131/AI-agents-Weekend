/** Client-side copy for read-aloud + advisor bubble (no backend dependency). */

import type { SlimePersona } from '../app/model';

const BUBBLE_MAX = 160;
const BODY_COLLAPSE_AT = 420;

function completeShortSentence(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const window = t.slice(0, max);
  const boundaries = [
    ...[' by ', ' which ', ' while ', ' because ', ' so that ', ' for ', ' with ']
      .map((needle) => {
        const idx = window.toLowerCase().lastIndexOf(needle);
        return idx > 56 ? idx : -1;
      }),
    ...[',', ';', ':', ' — ', ' – ', ' - ']
      .map((needle) => {
        const idx = window.lastIndexOf(needle);
        return idx > 56 ? idx : -1;
      }),
  ].filter((idx) => idx > 0);
  const cut = boundaries.length ? Math.max(...boundaries) : window.lastIndexOf(' ');
  let out = (cut > 56 ? window.slice(0, cut) : window).trim();
  out = out.replace(/[,:;—–-]\s*$/, '').trim();
  out = out.replace(/\b(and|or|but|by|with|for|to|of|in|on|at|which|because|while)$/i, '').trim();
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

function firstSentence(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const m = t.match(/^[\s\S]{1,400}?[.!?](?=\s|$)/);
  if (m) return m[0].trim();
  return completeShortSentence(t, BUBBLE_MAX);
}

export function bubbleTextFromReasoning(reasoning: string, titleFallback: string): string {
  const s = firstSentence(reasoning);
  if (s) {
    return completeShortSentence(s, BUBBLE_MAX);
  }
  const t = titleFallback.trim();
  return t || 'Your recommendation is ready — review the details below.';
}

/** Trims / softens bubble copy from `SlimePersona.replyLength` and optional direct address. */
export function bubbleTextFromReasoningWithPersona(
  reasoning: string,
  titleFallback: string,
  persona?: SlimePersona | null,
): string {
  const base = bubbleTextFromReasoning(reasoning, titleFallback);
  if (!persona) return base;
  const max =
    persona.replyLength === 'short' ? 110 : persona.replyLength === 'detailed' ? 200 : BUBBLE_MAX;
  let out = completeShortSentence(base, max);
  const nick = (persona.userNickname || '').trim();
  if (nick && persona.warmth >= 2 && !out.toLowerCase().includes(nick.toLowerCase())) {
    const rest = out.length ? `${out.charAt(0).toLowerCase()}${out.slice(1)}` : out;
    out = `${nick}, ${rest}`.trim();
  }
  return out;
}

export function speechTextFromRecommendation(title: string, bubble: string, firstAction?: string): string {
  const stripTrail = (s: string) => s.trim().replace(/\.+$/, '').trim();
  const parts: string[] = [];
  const t = stripTrail(title);
  const b = stripTrail(bubble);
  if (t) parts.push(t);
  if (b) parts.push(b);
  if (firstAction?.trim()) parts.push(`Next step: ${firstAction.trim()}`);
  return parts.join('. ');
}

export function conciseReasoningPreview(reasoning: string, max = BODY_COLLAPSE_AT): string {
  const t = reasoning.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.45 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

export function isLongReasoning(reasoning: string, threshold = BODY_COLLAPSE_AT): boolean {
  return reasoning.trim().length > threshold;
}
