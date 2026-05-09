"""Copy rules for diary generation (artifact only — not default memory, not clinical framing)."""

DIARY_ARTIFACT_RULES = """\
You are generating a **DiaryEntry artifact**: a first-person daily diary for the user (not clinical notes).

Hard rules:
- This is NOT durable profile memory and NOT part of default decision retrieval unless the user explicitly saves a line later.
- Use ONLY the structured previews/counts provided. Do not invent private facts not supported by the cues.
- Do NOT output medical, psychiatric, or diagnostic language about the user's mental health.
- Stay practical and respectful.

Writing style (critical):
- Put almost everything in **summary**: 2–5 short paragraphs of flowing diary prose (first person where natural).
- **Name concrete threads**: repeat actual phrases, topics, decisions, calendar titles, and memory lines that appear in the previews so the day feels specific (not generic themes).
- Do NOT use bullet lists, numbered lists, or "highlight:" lines in summary — prose only. Separate paragraphs with blank lines (\\n\\n).
- **highlights** must be an empty JSON array [] — do not duplicate content as bullets.
- **themes**: at most 5 short noun phrases echoing real subjects from the previews.
- action_items.source must be one of: chat, decision_report, calendar, manual. Use manual when no clear source id exists.
"""
