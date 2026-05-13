/**
 * Parse backend `report_surface` or derive a compatible surface from raw trace JSON (legacy traces).
 */
import type {
  EvidenceReference,
  EvidenceRefType,
  FuturePath,
  GroundingSignal,
  GroundingStrength,
  PersonalizedFitReason,
  PrimaryNextAction,
  ReportSurface,
} from '../app/model';

function truncate(text: string, maxLen: number): string {
  const t = (text || '').trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1).trim()}…`;
}

function dedupeRefs(refs: EvidenceReference[]): EvidenceReference[] {
  const seen = new Set<string>();
  const out: EvidenceReference[] = [];
  for (const r of refs) {
    const key = `${r.type}:${r.text.slice(0, 120).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function driverToTrigger(driver: string): string {
  const d = driver.trim();
  if (!d) return '';
  const lower = d.toLowerCase();
  if (/^(if|when|after|once)\s/i.test(d)) {
    return d.charAt(0).toUpperCase() + d.slice(1);
  }
  return `When ${lower.charAt(0)}${lower.slice(1)}`;
}

function parseEvidenceRef(raw: Record<string, unknown>): EvidenceReference | null {
  const type = raw.type as EvidenceRefType | undefined;
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!type || !text) return null;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : undefined;
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : undefined;
  return { type, id, text, confidence };
}

function parseGroundingSignal(raw: Record<string, unknown>): GroundingSignal | null {
  const type = raw.type as GroundingSignal['type'] | undefined;
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  const strength = raw.strength as GroundingStrength | undefined;
  if (!type || !label || !text) return null;
  return {
    type,
    label,
    text,
    strength: strength === 'strong' || strength === 'thin' || strength === 'mixed' ? strength : 'mixed',
  };
}

export function parseReportSurface(raw: unknown): ReportSurface | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const groundingNote = typeof o.grounding_note === 'string' ? o.grounding_note.trim() : '';
  const rawStrength = o.grounding_strength as GroundingStrength | undefined;
  const groundingStrength =
    rawStrength === 'strong' || rawStrength === 'thin' || rawStrength === 'mixed'
      ? rawStrength
      : groundingNote.toLowerCase().includes('thin')
        ? 'thin'
        : 'mixed';
  const parsedGroundingSignals = Array.isArray(o.grounding_signals)
    ? o.grounding_signals
        .map((x) =>
          x && typeof x === 'object' ? parseGroundingSignal(x as Record<string, unknown>) : null,
        )
        .filter((x): x is GroundingSignal => Boolean(x))
    : [];
  const keyAssumptions = Array.isArray(o.key_assumptions)
    ? o.key_assumptions.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const prRaw = Array.isArray(o.personalized_reasons) ? o.personalized_reasons : [];
  const personalizedReasons: PersonalizedFitReason[] = [];
  for (const row of prRaw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const text = typeof r.text === 'string' ? r.text.trim() : '';
    if (!text) continue;
    const basedOn: EvidenceReference[] = [];
    const bo = Array.isArray(r.based_on) ? r.based_on : [];
    for (const e of bo) {
      if (!e || typeof e !== 'object') continue;
      const ref = parseEvidenceRef(e as Record<string, unknown>);
      if (ref) basedOn.push(ref);
    }
    personalizedReasons.push({ text, basedOn });
  }

  const fpRaw = Array.isArray(o.future_paths) ? o.future_paths : [];
  const futurePaths: FuturePath[] = [];
  for (const row of fpRaw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const pathType = r.path_type as FuturePath['pathType'] | undefined;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const summary = typeof r.summary === 'string' ? r.summary.trim() : '';
    if (!pathType || !title || !summary) continue;
    const triggerConditions = Array.isArray(r.trigger_conditions)
      ? r.trigger_conditions.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    const watchSignals = Array.isArray(r.watch_signals)
      ? r.watch_signals.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    const recommendedAction =
      typeof r.recommended_action === 'string' ? r.recommended_action.trim() : '';
    const basedOn: EvidenceReference[] = [];
    const bo = Array.isArray(r.based_on) ? r.based_on : [];
    for (const e of bo) {
      if (!e || typeof e !== 'object') continue;
      const ref = parseEvidenceRef(e as Record<string, unknown>);
      if (ref) basedOn.push(ref);
    }
    futurePaths.push({
      pathType,
      title,
      summary,
      triggerConditions,
      watchSignals,
      recommendedAction,
      basedOn,
    });
  }

  const na = o.primary_next_action;
  let primaryNextAction: PrimaryNextAction | undefined;
  if (na && typeof na === 'object') {
    const n = na as Record<string, unknown>;
    const text = typeof n.text === 'string' ? n.text.trim() : '';
    const durationEstimate =
      typeof n.duration_estimate === 'string' ? n.duration_estimate.trim() : '';
    const deadline =
      typeof n.deadline === 'string' && n.deadline.trim() ? n.deadline.trim() : undefined;
    if (text && durationEstimate) {
      primaryNextAction = { text, durationEstimate, deadline };
    }
  }

  if (!groundingNote || !primaryNextAction || futurePaths.length !== 3) return undefined;

  const allRefs = dedupeRefs([
    ...personalizedReasons.flatMap((r) => r.basedOn),
    ...futurePaths.flatMap((p) => p.basedOn),
  ]);
  const groundingSignals =
    parsedGroundingSignals.length > 0
      ? parsedGroundingSignals
      : fallbackGroundingSignalsFromRefs(allRefs, groundingNote, groundingStrength);

  return {
    groundingNote,
    groundingStrength,
    groundingSignals,
    personalizedReasons,
    futurePaths,
    keyAssumptions,
    primaryNextAction,
  };
}

function hasHistoryMemory(trace: Record<string, unknown>): boolean {
  const mem = trace.memory as Record<string, unknown> | undefined;
  const us = trace.user_state as Record<string, unknown> | undefined;
  if (!mem) return false;
  const spd = Array.isArray(mem.similar_past_decisions) ? mem.similar_past_decisions : [];
  if (spd.length > 0) return true;
  const me = Array.isArray(mem.memory_evidence) ? mem.memory_evidence : [];
  if (me.length > 0) return true;
  const bp = Array.isArray(mem.behavioral_patterns) ? mem.behavioral_patterns : [];
  if (bp.some((x) => String(x || '').trim())) return true;
  const facts = us && Array.isArray(us.profile_memory_facts) ? us.profile_memory_facts : [];
  return facts.length > 0;
}

function sharedEvidencePool(trace: Record<string, unknown>): EvidenceReference[] {
  const us = trace.user_state as Record<string, unknown> | undefined;
  const mem = trace.memory as Record<string, unknown> | undefined;
  const pool: EvidenceReference[] = [];
  const rawInput = typeof us?.raw_input === 'string' ? us.raw_input.trim() : '';
  if (rawInput) {
    pool.push({ type: 'user_statement', text: truncate(rawInput, 280) });
  }
  const constraints = us && Array.isArray(us.profile_constraints) ? us.profile_constraints : [];
  for (const c of constraints.slice(0, 3)) {
    const t = String(c || '').trim();
    if (t) pool.push({ type: 'current_constraint', text: t });
  }
  const meRows = mem && Array.isArray(mem.memory_evidence) ? mem.memory_evidence : [];
  for (const row of meRows.slice(0, 3)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const blob = String(r.memory_summary || r.source_excerpt || '').trim();
    if (!blob) continue;
    const id =
      typeof r.decision_id === 'string' && r.decision_id.trim() ? r.decision_id.trim() : undefined;
    pool.push({ type: 'memory', id, text: truncate(blob, 220) });
  }
  const spd = mem && Array.isArray(mem.similar_past_decisions) ? mem.similar_past_decisions : [];
  for (const pd of spd.slice(0, 2)) {
    if (!pd || typeof pd !== 'object') continue;
    const r = pd as Record<string, unknown>;
    const summ = String(r.situation_summary || '').trim();
    if (!summ) continue;
    const id = typeof r.decision_id === 'string' ? r.decision_id : undefined;
    pool.push({ type: 'past_decision', id, text: truncate(summ, 220) });
  }
  const pri = us && Array.isArray(us.profile_priorities) ? us.profile_priorities : [];
  for (const p of pri.slice(0, 2)) {
    const t = String(p || '').trim();
    if (t) pool.push({ type: 'profile', text: t });
  }
  const pfacts = us && Array.isArray(us.profile_memory_facts) ? us.profile_memory_facts : [];
  for (const f of pfacts.slice(0, 2)) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    const text = String(r.text || '').trim();
    if (!text) continue;
    const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : undefined;
    const confidence = typeof r.confidence === 'number' ? r.confidence : undefined;
    pool.push({ type: 'profile', id, text: truncate(text, 200), confidence });
  }
  const bp = mem && Array.isArray(mem.behavioral_patterns) ? mem.behavioral_patterns : [];
  for (const pat of bp.slice(0, 2)) {
    const t = String(pat || '').trim();
    if (t) pool.push({ type: 'memory', text: t });
  }
  const evidence = trace.evidence as Record<string, unknown> | undefined;
  const worldRows = [
    ...(Array.isArray(evidence?.base_rates) ? evidence.base_rates : []),
    ...(Array.isArray(evidence?.facts) ? evidence.facts : []),
    ...(Array.isArray(evidence?.recent_events) ? evidence.recent_events : []),
  ];
  for (const row of worldRows.slice(0, 3)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const text = String(r.text || '').trim();
    if (!text) continue;
    const id =
      typeof r.source_url === 'string' && r.source_url.trim() ? r.source_url.trim() : undefined;
    const confidence = typeof r.confidence === 'number' ? r.confidence : undefined;
    pool.push({ type: 'world_evidence', id, text: truncate(text, 240), confidence });
  }
  return dedupeRefs(pool);
}

function refsOfType(pool: EvidenceReference[], types: EvidenceRefType[]): EvidenceReference[] {
  return pool.filter((r) => types.includes(r.type));
}

function groundingStrengthFor(pool: EvidenceReference[]): GroundingStrength {
  const userRefs = refsOfType(pool, ['user_statement', 'current_constraint']);
  const personalRefs = refsOfType(pool, ['profile', 'past_decision', 'memory']);
  const worldRefs = refsOfType(pool, ['world_evidence']);
  if (userRefs.length > 0 && personalRefs.length >= 2) return 'strong';
  if (userRefs.length > 0 && (personalRefs.length > 0 || worldRefs.length > 0)) return 'mixed';
  return 'thin';
}

function groundingNoteFor(strength: GroundingStrength, hasHistory: boolean, hasWorld: boolean): string {
  if (strength === 'strong') {
    return 'These futures tie what you said today to retrieved memories and tradeoffs—not a generic three-story forecast.';
  }
  if (strength === 'mixed') {
    if (hasHistory) {
      return 'Grounded in your current context plus some personal history and memories; treat the recommendation as a strong-fit hypothesis, then verify the open questions.';
    }
    if (hasWorld) {
      return 'Based mostly on current context plus external evidence; personal history is light, so verify fit before committing.';
    }
    return 'Based mostly on current context, with limited personal history behind the recommendation.';
  }
  return 'Based mostly on current context, not past behavior. Evidence is thin, so verify the missing facts before treating this as a final call.';
}

function groundingSignalsFor(
  trace: Record<string, unknown>,
  pool: EvidenceReference[],
  strength: GroundingStrength,
): GroundingSignal[] {
  const us = trace.user_state as Record<string, unknown> | undefined;
  const refl = (trace.reflection as Record<string, unknown>) || {};
  const userRefs = refsOfType(pool, ['user_statement', 'current_constraint']);
  const personalRefs = refsOfType(pool, ['profile', 'past_decision', 'memory']);
  const worldRefs = refsOfType(pool, ['world_evidence']);
  const gaps = [
    ...(Array.isArray(refl.information_gaps) ? refl.information_gaps : []),
    ...(Array.isArray(refl.uncertainty_sources) ? refl.uncertainty_sources : []),
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean);

  const signals: GroundingSignal[] = [];
  if (userRefs[0]) {
    signals.push({
      type: 'user_context',
      label: 'User context',
      text: truncate(userRefs[0].text, 180),
      strength: 'strong',
    });
  } else {
    const currentBehavior = String(us?.current_behavior || '').trim();
    if (currentBehavior) {
      signals.push({
        type: 'user_context',
        label: 'User context',
        text: truncate(currentBehavior, 180),
        strength: 'mixed',
      });
    }
  }

  signals.push(
    personalRefs[0]
      ? {
          type: 'personal_memory',
          label: 'Personal memory',
          text: truncate(personalRefs[0].text, 180),
          strength: personalRefs.length >= 2 ? 'strong' : 'mixed',
        }
      : {
          type: 'personal_memory',
          label: 'Personal memory',
          text: 'No similar past decision or durable profile memory was found for this recommendation.',
          strength: 'thin',
        },
  );

  signals.push(
    worldRefs[0]
      ? {
          type: 'external_evidence',
          label: 'External evidence',
          text: truncate(worldRefs[0].text, 180),
          strength: 'mixed',
        }
      : {
          type: 'external_evidence',
          label: 'External evidence',
          text: 'No strong web or source-backed fact was attached to this report surface.',
          strength: 'thin',
        },
  );

  signals.push({
    type: 'uncertainty',
    label: 'Check before acting',
    text: gaps[0]
      ? truncate(gaps[0], 180)
      : 'No major missing fact was surfaced, but this is still a decision aid, not final authority.',
    strength: gaps[0] ? 'thin' : strength,
  });

  return signals.slice(0, 4);
}

function fallbackGroundingSignalsFromRefs(
  refs: EvidenceReference[],
  groundingNote: string,
  strength: GroundingStrength,
): GroundingSignal[] {
  const userRefs = refsOfType(refs, ['user_statement', 'current_constraint']);
  const personalRefs = refsOfType(refs, ['profile', 'past_decision', 'memory']);
  const worldRefs = refsOfType(refs, ['world_evidence']);
  return [
    {
      type: 'user_context',
      label: 'User context',
      text: userRefs[0]?.text || groundingNote,
      strength: userRefs[0] ? 'strong' : strength,
    },
    {
      type: 'personal_memory',
      label: 'Personal memory',
      text:
        personalRefs[0]?.text ||
        'No similar past decision or durable profile memory was attached to this report.',
      strength: personalRefs.length >= 2 ? 'strong' : personalRefs.length ? 'mixed' : 'thin',
    },
    {
      type: 'external_evidence',
      label: 'External evidence',
      text: worldRefs[0]?.text || 'No strong web or source-backed fact was attached to this report surface.',
      strength: worldRefs[0] ? 'mixed' : 'thin',
    },
    {
      type: 'uncertainty',
      label: 'Check before acting',
      text: groundingNote,
      strength,
    },
  ];
}

type ScenarioRow = {
  label: 'best' | 'base' | 'worst';
  trajectory: string;
  key_drivers: string[];
};

function scenarioMap(sf: Record<string, unknown>): Partial<Record<'best' | 'base' | 'worst', ScenarioRow>> {
  const scenarios = Array.isArray(sf.scenarios) ? sf.scenarios : [];
  const out: Partial<Record<'best' | 'base' | 'worst', ScenarioRow>> = {};
  for (const s of scenarios) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    const label = r.label as ScenarioRow['label'] | undefined;
    if (label !== 'best' && label !== 'base' && label !== 'worst') continue;
    const trajectory = String(r.trajectory || '').trim();
    const kd = Array.isArray(r.key_drivers)
      ? r.key_drivers.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    out[label] = { label, trajectory, key_drivers: kd };
  }
  return out;
}

function watchMix(
  refl: Record<string, unknown>,
  scenario: ScenarioRow | undefined,
  limit = 5,
): string[] {
  const parts: string[] = [];
  const push = (x: string) => {
    const t = x.trim();
    if (t && !parts.includes(t)) parts.push(t);
  };
  if (scenario) {
    for (const d of scenario.key_drivers) push(d);
  }
  const us = Array.isArray(refl.uncertainty_sources)
    ? refl.uncertainty_sources.map((x) => String(x || '').trim())
    : [];
  for (const x of us) push(x);
  const gaps = Array.isArray(refl.information_gaps)
    ? refl.information_gaps.map((x) => String(x || '').trim())
    : [];
  for (const x of gaps) push(x);
  return parts.slice(0, limit);
}

function pathActions(pathType: FuturePath['pathType']): string {
  if (pathType === 'expected') return 'Keep this direction and schedule the first concrete step.';
  if (pathType === 'friction')
    return 'Add slack for setbacks and decide in advance what “good enough” looks like.';
  return 'Stay adaptable: set a checkpoint to revisit whether you still want this branch.';
}

function buildPath(args: {
  pathType: FuturePath['pathType'];
  title: string;
  scenario: ScenarioRow | undefined;
  fallbackSummary: string;
  trace: Record<string, unknown>;
  pool: EvidenceReference[];
  evalRationale: string | null;
}): FuturePath {
  const refl = (args.trace.reflection as Record<string, unknown>) || {};
  let summary: string;
  let triggers: string[];
  let watch: string[];

  if (args.scenario && args.scenario.trajectory) {
    summary = truncate(args.scenario.trajectory, 320);
    triggers = args.scenario.key_drivers.map(driverToTrigger).filter(Boolean).slice(0, 5);
    if (!triggers.length) {
      triggers = ['When day-to-day execution meets the assumptions behind this choice.'];
    }
    watch = watchMix(refl, args.scenario);
  } else {
    summary = truncate(args.fallbackSummary, 320);
    const us = Array.isArray(refl.uncertainty_sources)
      ? refl.uncertainty_sources.map((x) => truncate(String(x || ''), 160)).filter(Boolean)
      : [];
    const gaps = Array.isArray(refl.information_gaps)
      ? refl.information_gaps.map((x) => truncate(String(x || ''), 160)).filter(Boolean)
      : [];
    triggers = [...us.slice(0, 2), ...gaps.slice(0, 2)].filter(Boolean);
    if (!triggers.length) {
      triggers = ['When stress, timeline, or new information shifts the tradeoffs.'];
    }
    watch = [
      ...us.slice(0, 3),
      ...(Array.isArray(refl.information_gaps)
        ? refl.information_gaps.map((x) => truncate(String(x || ''), 160)).filter(Boolean)
        : []),
    ].slice(0, 5);
  }

  let based: EvidenceReference[] = [...args.pool];
  if (args.scenario) {
    for (const d of args.scenario.key_drivers.slice(0, 2)) {
      const t = d.trim();
      if (t) based.push({ type: 'memory', text: truncate(t, 160) });
    }
  }
  if (args.evalRationale) {
    based.push({ type: 'tradeoff', text: truncate(args.evalRationale, 200) });
  }
  based = dedupeRefs(based);
  if (!based.length) {
    const us = args.trace.user_state as Record<string, unknown> | undefined;
    const raw = String(us?.raw_input || us?.current_behavior || '').trim();
    based = [{ type: 'user_statement', text: truncate(raw, 200) }];
  }

  return {
    pathType: args.pathType,
    title: args.title,
    summary,
    triggerConditions: triggers,
    watchSignals:
      watch.length > 0 ? watch : ['Whether your stress level or timeline materially changes.'],
    recommendedAction: pathActions(args.pathType),
    basedOn: based.slice(0, 8),
  };
}

function personalizedReasons(
  trace: Record<string, unknown>,
  pool: EvidenceReference[],
): PersonalizedFitReason[] {
  const mem = trace.memory as Record<string, unknown> | undefined;
  const us = trace.user_state as Record<string, unknown> | undefined;
  const rec = trace.recommendation as Record<string, unknown> | undefined;
  const reasons: PersonalizedFitReason[] = [];

  const bp = mem && Array.isArray(mem.behavioral_patterns) ? mem.behavioral_patterns : [];
  const p0 = String(bp[0] || '').trim();
  if (p0) {
    const chip = pool.find((r) => r.text.toLowerCase().includes(p0.slice(0, 80).toLowerCase()));
    reasons.push({
      text: truncate(`We factor in a pattern from your history: ${p0}`, 240),
      basedOn: chip ? [chip] : [{ type: 'memory', text: p0 }],
    });
  }

  const cons = us && Array.isArray(us.profile_constraints) ? us.profile_constraints : [];
  const c0 = String(cons[0] || '').trim();
  if (c0) {
    reasons.push({
      text: truncate(`Your stated constraint "${c0}" narrows what "reasonable" looks like.`, 260),
      basedOn: [{ type: 'current_constraint', text: c0 }],
    });
  }

  const spd = mem && Array.isArray(mem.similar_past_decisions) ? mem.similar_past_decisions : [];
  if (spd[0] && typeof spd[0] === 'object') {
    const pd = spd[0] as Record<string, unknown>;
    const summ = String(pd.situation_summary || '').trim();
    const chose = String(pd.chosen_option || '').trim();
    if (summ) {
      reasons.push({
        text: truncate(`In a comparable moment you leaned toward: ${chose || 'a specific choice'}.`, 260),
        basedOn: [
          {
            type: 'past_decision',
            id: typeof pd.decision_id === 'string' ? pd.decision_id : undefined,
            text: truncate(summ, 200),
          },
        ],
      });
    }
  }

  const reasoning = typeof rec?.reasoning === 'string' ? rec.reasoning.trim() : '';
  if (reasons.length < 2 && reasoning) {
    reasons.push({
      text: 'The recommendation matches how your options score against goals, risk, and regret—open detailed tradeoffs if you want the numbers.',
      basedOn: [{ type: 'tradeoff', text: truncate(reasoning, 220) }],
    });
  }

  const pri = us && Array.isArray(us.profile_priorities) ? us.profile_priorities : [];
  const pr = String(pri[0] || '').trim();
  if (reasons.length < 2 && pr) {
    reasons.push({
      text: truncate(`It aligns with a priority you’ve emphasized: ${pr}`, 220),
      basedOn: [{ type: 'profile', text: pr }],
    });
  }

  return reasons.slice(0, 3);
}

/** Shared heuristic for “how long” hints in the UI. */
export function durationEstimateForAction(action: string, deadline: string | undefined): string {
  if (deadline?.trim()) return `Target: ${deadline.trim()}`;
  const a = action.toLowerCase();
  if (/(week|month|quarter)/i.test(a)) return 'Spread across a few focused sessions';
  if (/(call|email|message|text)/i.test(a)) return 'About 15–30 minutes';
  if (/(research|read|review|compare)/i.test(a)) return 'About 45–90 minutes';
  return 'About 20–45 minutes';
}

export function deriveReportSurfaceFromTrace(trace: Record<string, unknown>): ReportSurface | null {
  const rec = trace.recommendation as Record<string, unknown> | undefined;
  const chosenId = typeof rec?.chosen_option_id === 'string' ? rec.chosen_option_id.trim() : '';
  if (!chosenId) return null;

  const futures = Array.isArray(trace.futures) ? trace.futures : [];
  const sfRaw = futures.find(
    (f) => f && typeof f === 'object' && String((f as Record<string, unknown>).option_id) === chosenId,
  ) as Record<string, unknown> | undefined;

  const options = Array.isArray(trace.options) ? trace.options : [];
  const chosenOpt = options.find(
    (o) => o && typeof o === 'object' && String((o as Record<string, unknown>).option_id) === chosenId,
  ) as Record<string, unknown> | undefined;

  const evaluations = Array.isArray(trace.evaluations) ? trace.evaluations : [];
  const evalRow = evaluations.find(
    (e) => e && typeof e === 'object' && String((e as Record<string, unknown>).option_id) === chosenId,
  ) as Record<string, unknown> | undefined;
  const evalRationale =
    typeof evalRow?.rationale === 'string' && evalRow.rationale.trim()
      ? evalRow.rationale.trim()
      : null;

  const pool = sharedEvidencePool(trace);
  const refl = (trace.reflection as Record<string, unknown>) || {};

  const groundingStrength = groundingStrengthFor(pool);
  const groundingNote = groundingNoteFor(
    groundingStrength,
    hasHistoryMemory(trace),
    refsOfType(pool, ['world_evidence']).length > 0,
  );
  const groundingSignals = groundingSignalsFor(trace, pool, groundingStrength);

  const reasoning = typeof rec?.reasoning === 'string' ? rec.reasoning.trim() : '';
  const us = trace.user_state as Record<string, unknown> | undefined;
  const rawSit = String(us?.raw_input || '').trim();
  const fbExpected =
    reasoning ||
    rawSit ||
    'If things progress steadily, this choice compounds quietly over time.';
  const pe = Array.isArray(refl.possible_errors) ? refl.possible_errors : [];
  const fbFriction = String(pe[0] || '').trim() || 'Friction shows up when assumptions slip or capacity tightens.';
  const unc = Array.isArray(refl.uncertainty_sources) ? refl.uncertainty_sources : [];
  const fbPivot =
    String(unc[0] || '').trim() ||
    'A pivot becomes plausible if the upside appears or constraints loosen.';

  let futurePaths: FuturePath[];
  const sm = sfRaw ? scenarioMap(sfRaw) : {};
  const hasScenarios = Boolean(sm.base || sm.worst || sm.best);
  if (hasScenarios) {
    futurePaths = [
      buildPath({
        pathType: 'expected',
        title: 'Expected Path',
        scenario: sm.base,
        fallbackSummary: fbExpected,
        trace,
        pool,
        evalRationale,
      }),
      buildPath({
        pathType: 'friction',
        title: 'Friction Path',
        scenario: sm.worst,
        fallbackSummary: fbFriction,
        trace,
        pool,
        evalRationale,
      }),
      buildPath({
        pathType: 'pivot',
        title: 'Pivot Path',
        scenario: sm.best,
        fallbackSummary: fbPivot,
        trace,
        pool,
        evalRationale,
      }),
    ];
  } else {
    futurePaths = [
      buildPath({
        pathType: 'expected',
        title: 'Expected Path',
        scenario: undefined,
        fallbackSummary: fbExpected,
        trace,
        pool,
        evalRationale,
      }),
      buildPath({
        pathType: 'friction',
        title: 'Friction Path',
        scenario: undefined,
        fallbackSummary: fbFriction,
        trace,
        pool,
        evalRationale,
      }),
      buildPath({
        pathType: 'pivot',
        title: 'Pivot Path',
        scenario: undefined,
        fallbackSummary: fbPivot,
        trace,
        pool,
        evalRationale,
      }),
    ];
  }

  let keyAssumptions: string[] = [];
  if (chosenOpt && Array.isArray(chosenOpt.key_assumptions)) {
    keyAssumptions = chosenOpt.key_assumptions
      .map((x) => truncate(String(x || ''), 240))
      .filter(Boolean)
      .slice(0, 8);
  }

  const nextActions = Array.isArray(rec?.next_actions) ? rec.next_actions : [];
  let primaryNextAction: PrimaryNextAction;
  if (nextActions[0] && typeof nextActions[0] === 'object') {
    const na = nextActions[0] as Record<string, unknown>;
    const text = String(na.action || '').trim();
    const deadline =
      typeof na.deadline === 'string' && na.deadline.trim() ? na.deadline.trim() : undefined;
    primaryNextAction = {
      text: text || 'Capture your decision in one sentence and pick a single next checkpoint.',
      durationEstimate: durationEstimateForAction(text, deadline),
      deadline,
    };
  } else {
    primaryNextAction = {
      text: 'Capture your decision in one sentence and pick a single next checkpoint.',
      durationEstimate: 'About 10 minutes',
    };
  }

  let personalizedReasonsOut = personalizedReasons(trace, pool);
  if (!personalizedReasonsOut.length) {
    personalizedReasonsOut = [
      {
        text: 'We weighted your stated situation against the option tradeoffs surfaced in this run.',
        basedOn:
          pool.slice(0, 2).length > 0
            ? pool.slice(0, 2)
            : [{ type: 'user_statement', text: truncate(rawSit, 200) }],
      },
    ];
  }

  return {
    groundingNote,
    groundingStrength,
    groundingSignals,
    personalizedReasons: personalizedReasonsOut,
    futurePaths,
    keyAssumptions,
    primaryNextAction,
  };
}
