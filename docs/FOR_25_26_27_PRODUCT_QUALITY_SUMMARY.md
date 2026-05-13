# FOR-25 / FOR-26 / FOR-27 Product Quality Summary

## Scope

This change set addresses the product-quality track for the decision report experience:

- FOR-25: make the decision report easier to understand, present, and demo.
- FOR-26: make recommendation grounding visible instead of hiding why the agent chose a path.
- FOR-27: make generated execution actions more realistic and prevent calendar clutter.

The goal is not to redesign the whole app. The goal is to make the MVP report flow feel more trustworthy, more personal, and more executable.

## FOR-25: Decision Report UX

### What Changed

- Reworked the report order so the recommendation appears first.
- Added a short "Mochi shares" explanation that summarizes the recommendation in a friendlier voice.
- Kept deeper reasoning available, but moved it behind progressive disclosure instead of forcing users to read everything at once.
- Updated report read-aloud so voice playback reads only the concise Mochi summary, not the full report.
- Added narration helpers and tests so the spoken summary does not cut off mid-sentence.

### Why It Matters

The old report had useful information, but it asked the user to process too much at once. For a pitch/demo, the first few seconds matter: users should immediately know what the agent recommends, why it fits them, and what to do next.

### Acceptance Criteria Covered

- The report gives a clear recommendation quickly.
- The friendly summary is short enough for voice playback.
- Full reasoning remains available for users who want detail.
- The voice feature is cheaper and less noisy because it no longer reads the entire report.

## FOR-26: Recommendation Grounding

### What Changed

- Added backend grounding metadata to the report surface.
- Added grounding strength labels: strong, mixed, or thin.
- Added grounding signals for user context, personal memory, external evidence, and uncertainty.
- Expanded evidence reference types so tradeoffs, assumptions, and world evidence are not mislabeled as memory.
- Updated frontend parsing so legacy traces still render a reasonable grounding surface.
- Added evidence chips and popover text for the new evidence types.

### Why It Matters

The report should not feel like a generic AI answer. Users and teammates need to see whether the recommendation came from the current conversation, the user's remembered profile, outside evidence, or uncertain assumptions.

### Acceptance Criteria Covered

- The report shows why the recommendation is grounded.
- The UI distinguishes memory, tradeoffs, assumptions, and external evidence.
- Older traces still work through frontend fallback derivation.
- Tests cover backend report-surface grounding and frontend parsing.

## FOR-27: Execution Actions And Calendar Quality

### What Changed

- Updated the recommender prompt to ask for fewer, more concrete, user-controlled next actions.
- Added backend dedupe and capping for execution-ready actions.
- Limited report-derived execution tasks to a small practical set.
- Improved frontend action-to-calendar task mapping with clearer duration estimates.
- Fixed duplicated calendar blocks when report actions and preview steps contained the same task.
- Prevented empty saved planner state from overwriting report-derived tasks.

### Why It Matters

The execution calendar should feel like an assistant turning a decision into a real plan, not like a dump of every possible task. Duplicate or vague events make the feature feel unreliable, especially in a live demo.

### Acceptance Criteria Covered

- Generated action lists are capped and deduped.
- Calendar blocks are more practical and less duplicated.
- The planner keeps report-derived actions when opening from the report.
- Tests cover recommender action capping and calendar behavior.

## Additional Voice Support

This branch also updates the backend OpenAI TTS path so the Slime voice can use configurable OpenAI TTS models, voices, and instructions. The frontend still falls back to browser speech if backend TTS is unavailable.

This supports the product-quality work because the report's spoken summary is now short enough to use paid TTS without reading the whole report.

## Validation

Focused backend tests passed locally:

```bash
.venv/bin/python -m pytest tests/test_report_surface.py tests/test_recommender.py tests/test_calendar_agent.py tests/test_voice_slime.py
```

Result:

- 40 passed
- 1 existing Pydantic warning

Manual local checks:

- Shadow chat still responds locally.
- Decision report generation works after the clarification card is skipped or answered.
- Report view renders the new recommendation-first structure.
- Mochi voice reads the short Mochi summary rather than the whole report.
- Execution calendar creates deduped report actions.

## Known Follow-Ups

- The clarification card UX can be clearer. If it is already open, clicking "Generate Decision Report" currently expects the user to skip or answer the clarification first.
- Full frontend TypeScript checking is still blocked by existing unrelated type errors in the codebase.
- The execution calendar warning copy may need softer product wording before a polished demo.
