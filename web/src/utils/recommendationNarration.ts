/** Client-side copy for read-aloud + advisor bubble (no backend dependency). */

const BUBBLE_MAX = 160;
const BODY_COLLAPSE_AT = 420;

function firstSentence(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const m = t.match(/^[\s\S]{1,400}?[.!?](?=\s|$)/);
  if (m) return m[0].trim();
  return t.length > BUBBLE_MAX ? `${t.slice(0, BUBBLE_MAX - 1).trimEnd()}…` : t;
}

export function bubbleTextFromReasoning(reasoning: string, titleFallback: string): string {
  const s = firstSentence(reasoning);
  if (s) {
    return s.length > BUBBLE_MAX ? `${s.slice(0, BUBBLE_MAX - 1).trimEnd()}…` : s;
  }
  const t = titleFallback.trim();
  return t || 'Your recommendation is ready — review the details below.';
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
