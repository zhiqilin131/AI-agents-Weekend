/**
 * Resolve a lightweight EvidenceReference into richer copy for the detail popover.
 */
import type { EvidenceReference, EvidenceRefType } from '../app/model';

export type TraceUserStateLite = {
  raw_input?: string;
  profile_memory_facts?: Array<{
    id?: string;
    text?: string;
    category?: string;
    evidence?: string;
    predicate?: string;
    object_value?: string;
  }>;
  profile_constraints?: string[];
};

export type TraceMemoryBlockLite = {
  similar_past_decisions?: Array<{
    decision_id?: string;
    situation_summary?: string;
    chosen_option?: string;
    outcome?: string | null;
    timestamp?: string;
  }>;
  memory_evidence?: Array<{
    decision_id?: string;
    theme?: string;
    memory_summary?: string;
    source_excerpt?: string;
    outcome?: string;
    outcome_quality?: number | null;
    timestamp?: string;
    source_path?: string;
  }>;
  behavioral_patterns?: string[];
  prior_outcomes_summary?: string;
};

export type EvidenceDetailContent = {
  title: string;
  subtitle?: string;
  sections: Array<{ label: string; value: string }>;
};

function norm(s: string): string {
  return s.trim().toLowerCase().slice(0, 120);
}

export function resolveEvidenceDetail(
  ref: EvidenceReference,
  ctx: {
    memoryTrace?: TraceMemoryBlockLite;
    userState?: TraceUserStateLite;
  },
): EvidenceDetailContent {
  const mem = ctx.memoryTrace;
  const us = ctx.userState;
  const type = ref.type as EvidenceRefType;

  if (type === 'user_statement') {
    const full = (us?.raw_input || '').trim() || ref.text;
    return {
      title: 'What you said',
      subtitle: 'Full context used in this run',
      sections: [{ label: 'Message', value: full }],
    };
  }

  if (type === 'current_constraint') {
    return {
      title: 'Your constraint',
      subtitle: 'Pulled from your profile for this decision',
      sections: [{ label: 'Constraint', value: ref.text }],
    };
  }

  if (type === 'past_decision') {
    const list = mem?.similar_past_decisions ?? [];
    let row = ref.id ? list.find((d) => d.decision_id === ref.id) : undefined;
    if (!row && ref.text) {
      const key = norm(ref.text);
      row = list.find((d) => norm(d.situation_summary || '').includes(key.slice(0, 40)) || key.includes(norm(d.situation_summary || '').slice(0, 40)));
    }
    if (row) {
      return {
        title: 'Similar past decision',
        subtitle: row.decision_id ? `ID: ${row.decision_id}` : undefined,
        sections: [
          { label: 'Situation', value: row.situation_summary || '—' },
          { label: 'What you chose then', value: row.chosen_option || '—' },
          ...(row.outcome ? [{ label: 'Outcome recorded', value: row.outcome }] : []),
          ...(row.timestamp ? [{ label: 'When', value: row.timestamp }] : []),
        ],
      };
    }
    return {
      title: 'Past decision (summary)',
      sections: [{ label: 'Retrieved line', value: ref.text }],
    };
  }

  if (type === 'profile') {
    const facts = us?.profile_memory_facts ?? [];
    let fact = ref.id ? facts.find((f) => f.id === ref.id) : undefined;
    if (!fact && ref.text) {
      const key = norm(ref.text);
      fact = facts.find((f) => norm(f.text || '') === key || norm(f.text || '').includes(key.slice(0, 30)));
    }
    if (fact) {
      const parts: Array<{ label: string; value: string }> = [{ label: 'Fact', value: fact.text || ref.text }];
      if (fact.category) parts.push({ label: 'Category', value: fact.category });
      if (fact.predicate || fact.object_value) {
        parts.push({
          label: 'Structured',
          value: [fact.predicate, fact.object_value].filter(Boolean).join(' → ') || '—',
        });
      }
      if (fact.evidence) parts.push({ label: 'Evidence / quote', value: fact.evidence });
      return { title: 'Profile memory', subtitle: fact.id ? `ID: ${fact.id}` : undefined, sections: parts };
    }
    return {
      title: 'Profile signal',
      sections: [{ label: 'Line', value: ref.text }],
    };
  }

  /* memory — patterns, evaluation snippets, or memory_evidence rows */
  const evRows = mem?.memory_evidence ?? [];
  let ev = ref.id ? evRows.find((e) => e.decision_id === ref.id) : undefined;
  if (!ev && ref.text) {
    const key = ref.text.trim().toLowerCase();
    ev = evRows.find(
      (e) =>
        (e.memory_summary || '').toLowerCase().includes(key.slice(0, 48)) ||
        (e.source_excerpt || '').toLowerCase().includes(key.slice(0, 48)),
    );
  }
  if (ev) {
    const sections: Array<{ label: string; value: string }> = [];
    if (ev.memory_summary) sections.push({ label: 'Summary', value: ev.memory_summary });
    if (ev.source_excerpt) sections.push({ label: 'Source excerpt', value: ev.source_excerpt });
    if (ev.outcome) sections.push({ label: 'Outcome', value: ev.outcome });
    if (ev.theme) sections.push({ label: 'Theme', value: ev.theme });
    if (typeof ev.outcome_quality === 'number') sections.push({ label: 'Quality', value: `${ev.outcome_quality}/5` });
    if (ev.timestamp) sections.push({ label: 'Timestamp', value: ev.timestamp });
    if (ev.source_path) sections.push({ label: 'Source path', value: ev.source_path });
    return {
      title: 'Retrieved memory',
      subtitle: ev.decision_id ? `Decision: ${ev.decision_id}` : undefined,
      sections: sections.length ? sections : [{ label: 'Detail', value: ref.text }],
    };
  }

  const patterns = mem?.behavioral_patterns ?? [];
  const pat = patterns.find((p) => ref.text.trim() && p.toLowerCase().includes(ref.text.trim().toLowerCase().slice(0, 24)));
  if (pat) {
    return {
      title: 'Behavioral pattern',
      sections: [
        { label: 'Pattern', value: pat },
        ...(mem?.prior_outcomes_summary
          ? [{ label: 'Prior outcomes (bundle)', value: mem.prior_outcomes_summary }]
          : []),
      ],
    };
  }

  return {
    title: 'Source note',
    sections: [{ label: 'Text', value: ref.text }],
  };
}
