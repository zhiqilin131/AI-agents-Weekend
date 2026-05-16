"""Prompt assembly for per-option follow-up (Option Coach) chat."""

from __future__ import annotations

from typing import Any

from foresight_x.schemas import DecisionTrace, Option


def _merge_option_fields(option: Option, client: dict[str, Any] | None) -> dict[str, Any]:
    cc = client if isinstance(client, dict) else {}
    desc = str(option.description or "").strip()
    if not desc:
        desc = str(cc.get("description") or "").strip()
    assumptions = list(option.key_assumptions or [])
    if not assumptions and isinstance(cc.get("key_assumptions"), list):
        assumptions = [str(a).strip() for a in cc["key_assumptions"] if str(a).strip()]
    reversal = str(option.cost_of_reversal or "").strip()
    if not reversal:
        reversal = str(cc.get("cost_of_reversal") or "").strip()
    return {
        "name": option.name,
        "description": desc or "(no description in trace)",
        "key_assumptions": assumptions,
        "cost_of_reversal": reversal or "unknown",
        "is_recommended": bool(cc.get("is_recommended")),
        "importance_rank": cc.get("importance_rank"),
        "importance_tier": str(cc.get("importance_tier") or "").strip(),
        "tradeoff_scores": cc.get("tradeoff_scores") if isinstance(cc.get("tradeoff_scores"), dict) else {},
    }


def _evaluation_block(trace: DecisionTrace, option_id: str, client_scores: dict[str, Any]) -> str:
    ev = next((e for e in trace.evaluations if e.option_id == option_id), None)
    lines: list[str] = []
    if ev is not None:
        lines.extend(
            [
                f"- expected value: {ev.expected_value_score:.1f}/10",
                f"- risk: {ev.risk_score:.1f}/10",
                f"- regret: {ev.regret_score:.1f}/10",
                f"- uncertainty: {ev.uncertainty_score:.1f}/10",
                f"- goal alignment: {ev.goal_alignment_score:.1f}/10",
                f"- analyst rationale: {ev.rationale.strip() or '(none)'}",
            ]
        )
    elif client_scores:
        for k, v in client_scores.items():
            lines.append(f"- {k}: {v}")
    else:
        lines.append("(no MCDA scores recorded)")
    return "\n".join(lines)


def _futures_block(trace: DecisionTrace, option_id: str) -> str:
    futures = [f for f in trace.futures if f.option_id == option_id]
    if not futures:
        return "(no scenario rows)"
    bits: list[str] = []
    for f in futures[:2]:
        lines = [f"- horizon: {f.time_horizon}"]
        for s in f.scenarios[:4]:
            pct = int(round(float(s.probability) * 100))
            lines.append(f"  - {s.label} ({pct}%): {s.trajectory}")
            if s.key_drivers:
                lines.append(f"    drivers: {', '.join(s.key_drivers[:4])}")
        bits.append("\n".join(lines))
    return "\n\n".join(bits)


def _other_options_block(trace: DecisionTrace, selected_id: str) -> str:
    others = [o for o in trace.options if o.option_id != selected_id]
    if not others:
        return "(only option)"
    return "\n".join(f"- {o.option_id}: {o.name}" for o in others[:6])


def _history_block(chat_history: list[dict[str, str]]) -> str:
    history_lines: list[str] = []
    for m in chat_history[-12:]:
        role = str(m.get("role", "")).strip().lower()
        content = str(m.get("content", "")).strip()
        if role not in {"user", "assistant"} or not content:
            continue
        label = "User" if role == "user" else "Coach"
        history_lines.append(f"{label}: {content}")
    return "\n".join(history_lines) if history_lines else "(none)"


def _report_surface_block(trace: DecisionTrace, *, is_chosen: bool) -> str:
    surf = trace.report_surface
    if surf is None:
        return ""
    lines: list[str] = []
    if surf.grounding_note.strip():
        lines.append(f"Grounding: {surf.grounding_note.strip()}")
    if surf.key_assumptions:
        lines.append("Key assumptions (report): " + "; ".join(surf.key_assumptions[:5]))
    if is_chosen and surf.primary_next_action.text.strip():
        pna = surf.primary_next_action
        lines.append(
            f"Primary next action for this recommendation: {pna.text.strip()}"
            + (f" (by {pna.deadline})" if pna.deadline else "")
        )
    if surf.personalized_reasons:
        lines.append("Why this fits the user:")
        for r in surf.personalized_reasons[:3]:
            if r.text.strip():
                lines.append(f"  - {r.text.strip()}")
    if surf.future_paths:
        lines.append("Future paths (narrative):")
        for fp in surf.future_paths[:3]:
            if fp.title.strip() or fp.summary.strip():
                lines.append(f"  - {fp.title.strip() or 'Path'}: {fp.summary.strip()}")
    return "\n".join(lines)


def build_option_chat_prompt(
    trace: DecisionTrace,
    option: Option,
    *,
    question: str,
    chat_history: list[dict[str, str]],
    client_context: dict[str, Any] | None = None,
) -> str:
    merged = _merge_option_fields(option, client_context)
    chosen_id = str(trace.recommendation.chosen_option_id or "").strip()
    is_chosen = option.option_id == chosen_id
    rank_note = ""
    if merged.get("importance_rank"):
        rank_note = f", importance rank #{merged['importance_rank']}"
    if merged.get("importance_tier"):
        rank_note += f" ({merged['importance_tier']} tier)"

    role_line = (
        "This is the report's recommended option."
        if is_chosen or merged.get("is_recommended")
        else "This is NOT the report's top recommendation — still coach execution if the user is pursuing it."
    )

    next_actions = ""
    if is_chosen and trace.recommendation.next_actions:
        acts = [a.action.strip() for a in trace.recommendation.next_actions[:4] if a.action.strip()]
        if acts:
            next_actions = "Suggested next actions from the report:\n" + "\n".join(f"- {a}" for a in acts)

    surface_block = _report_surface_block(trace, is_chosen=is_chosen)
    assumptions = merged["key_assumptions"]
    assumptions_text = "\n".join(f"- {a}" for a in assumptions) if assumptions else "(none listed)"

    return (
        "You are an implementation copilot for a decision support app.\n"
        f"The user is asking follow-up questions about ONE specific option: \"{merged['name']}\" ({option.option_id}).\n"
        "Stay anchored to this option's description, assumptions, scores, and simulated futures.\n"
        "Do not re-rank all options or push a different option unless the user explicitly asks to compare.\n"
        "Give practical guidance: steps, wording templates, sequencing, caveats, and how to handle pushback.\n"
        "Keep answers concise (4–10 sentences). Use bullets only when the user wants a checklist.\n\n"
        f"Decision situation:\n{trace.user_state.raw_input.strip()}\n\n"
        f"Selected option — {merged['name']} ({option.option_id}){rank_note}:\n"
        f"- role in report: {role_line}\n"
        f"- description: {merged['description']}\n"
        f"- cost of reversal: {merged['cost_of_reversal']}\n"
        f"- key assumptions:\n{assumptions_text}\n\n"
        f"MCDA / tradeoff evaluation:\n{_evaluation_block(trace, option.option_id, merged['tradeoff_scores'])}\n\n"
        f"Other options (names only — do not advocate switching unless asked):\n"
        f"{_other_options_block(trace, option.option_id)}\n\n"
        f"Overall recommendation reasoning:\n{trace.recommendation.reasoning.strip() or '(none)'}\n\n"
        f"{next_actions}\n\n"
        f"{surface_block}\n\n"
        f"Simulated futures for \"{merged['name']}\":\n{_futures_block(trace, option.option_id)}\n\n"
        f"Prior follow-up chat about this option:\n{_history_block(chat_history)}\n\n"
        f"User follow-up question:\n{question.strip()}\n\n"
        "Return JSON with one field: answer."
    )
