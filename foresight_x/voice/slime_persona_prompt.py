"""Compact Slime Buddy persona text for response synthesis (not tool routing)."""

from __future__ import annotations

import re
from typing import Any

from foresight_x.schemas import (
    SlimePersona,
    SlimePersonalityPreset,
    SlimePersonaTone,
    SlimeSelfModel,
)
from foresight_x.voice.slime_text_safety import (
    is_safe_slime_display_name,
    sanitize_role_identity_text,
    sanitize_user_nickname_text,
)

_UNSAFE_SUBSTRINGS = (
    "ignore safety",
    "ignore all safety",
    "bypass safety",
    "no confirmation",
    "never ask",
    "without confirmation",
    "without asking",
    "pretend memory",
    "always pretend",
    "reveal system",
    "reveal the prompt",
    "system prompt",
    "jailbreak",
    "execute without",
    "without user confirm",
    "override safety",
    "disregard safety",
    "pretend you are the user",
    "your memories are my memories",
    "never clarify",
)

_WARMTH_LABEL = ("very neutral", "lightly warm", "friendly", "affectionate / buddy-like, not saccharine")
_HUMOR_LABEL = ("no jokes", "subtle", "playful", "very playful")
_DIRECT_LABEL = ("gentle", "balanced", "direct", "blunt but respectful")
_LENGTH_HINT: dict[str, str] = {
    "short": "Voice replies: at most 1–2 short sentences. No long monologues.",
    "balanced": "Balanced length (about 2–4 short sentences).",
    "detailed": "Can go a bit longer when helpful, still avoid rambling.",
}

# Preset → partial persona fields (tone + sliders + reply_length)
PERSONA_PRESET_DEFAULTS: dict[str, dict[str, Any]] = {
    "calm_advisor": {
        "tone": SlimePersonaTone.CALM,
        "warmth": 1,
        "humor": 0,
        "directness": 1,
        "reply_length": "balanced",
    },
    "direct_strategist": {
        "tone": SlimePersonaTone.DIRECT,
        "warmth": 0,
        "humor": 0,
        "directness": 3,
        "reply_length": "short",
    },
    "warm_friend": {
        "tone": SlimePersonaTone.WARM,
        "warmth": 3,
        "humor": 1,
        "directness": 1,
        "reply_length": "balanced",
    },
    "playful_pet": {
        "tone": SlimePersonaTone.PLAYFUL,
        "warmth": 3,
        "humor": 2,
        "directness": 1,
        "reply_length": "short",
    },
    "analytical_coach": {
        "tone": SlimePersonaTone.ANALYTICAL,
        "warmth": 1,
        "humor": 0,
        "directness": 2,
        "reply_length": "detailed",
    },
    "hype_buddy": {
        "tone": SlimePersonaTone.ENCOURAGING,
        "warmth": 2,
        "humor": 2,
        "directness": 2,
        "reply_length": "short",
    },
    "gentle_companion": {
        "tone": SlimePersonaTone.WARM,
        "warmth": 3,
        "humor": 0,
        "directness": 0,
        "reply_length": "balanced",
    },
    "minimalist_assistant": {
        "tone": SlimePersonaTone.CONCISE,
        "warmth": 0,
        "humor": 0,
        "directness": 2,
        "reply_length": "short",
    },
}


def _collapse_whitespace(text: str, *, max_len: int = 320) -> str:
    """Single-line role text for prompts. Kept as a function so regex stays out of f-string `{...}` (SyntaxError on Py<3.12)."""
    return re.sub(r"\s+", " ", (text or "").strip())[:max_len]


def _is_unsafe_user_preference_line(line: str) -> bool:
    low = line.lower().strip()
    if not low:
        return True
    return any(bad in low for bad in _UNSAFE_SUBSTRINGS)


def sanitize_catchphrases(raw: list[str] | None) -> list[str]:
    out: list[str] = []
    for s in raw or []:
        t = str(s or "").strip().replace("\n", " ")[:40]
        if not t or _is_unsafe_user_preference_line(t):
            continue
        out.append(t)
        if len(out) >= 3:
            break
    return out


def sanitize_donts(raw: list[str] | None) -> list[str]:
    out: list[str] = []
    total = 0
    for s in raw or []:
        t = str(s or "").strip().replace("\n", " ")[:200]
        if not t or _is_unsafe_user_preference_line(t):
            continue
        if total + len(t) > 500:
            break
        out.append(t)
        total += len(t) + 1
        if len(out) >= 5:
            break
    return out


def default_slime_persona() -> SlimePersona:
    return SlimePersona()


def merge_slime_persona_defaults(stored: SlimePersona | None) -> SlimePersona:
    """Backward-compatible full persona (missing fields → product defaults)."""
    base = default_slime_persona()
    if not stored:
        return base
    data = base.model_dump()
    data.update(stored.model_dump(exclude_unset=False))
    p = SlimePersona.model_validate(data)
    nick = sanitize_user_nickname_text(p.user_nickname)
    role = sanitize_role_identity_text(p.role_identity or "")
    return SlimePersona.model_validate(
        {
            **p.model_dump(),
            "user_nickname": nick,
            "role_identity": role,
            "catchphrases": sanitize_catchphrases(p.catchphrases),
            "donts": sanitize_donts(p.donts),
        }
    )


def apply_personality_preset(preset: SlimePersonalityPreset) -> dict[str, Any]:
    key = preset.value if isinstance(preset, SlimePersonalityPreset) else str(preset)
    return dict(PERSONA_PRESET_DEFAULTS.get(key, PERSONA_PRESET_DEFAULTS["calm_advisor"]))


def merge_persona_patch(base: SlimePersona, patch: dict[str, Any]) -> SlimePersona:
    """Deep-merge API patch (camelCase or snake_case keys)."""
    cur = base.model_dump()
    p = dict(patch or {})
    key_map = {
        "userNickname": "user_nickname",
        "roleIdentity": "role_identity",
        # Voice routers often emit a plain "role" string for who the slime is.
        "role": "role_identity",
        "personalityPreset": "personality_preset",
        "replyLength": "reply_length",
        "companionRelationship": "companion_relationship",
    }
    norm: dict[str, Any] = {}
    for k, v in p.items():
        nk = key_map.get(k, k)
        if nk == "role_identity" and v is not None and not isinstance(v, str):
            continue
        norm[nk] = v

    preset_raw = norm.get("personality_preset")
    if preset_raw is not None:
        try:
            pe = (
                preset_raw
                if isinstance(preset_raw, SlimePersonalityPreset)
                else SlimePersonalityPreset(str(preset_raw).strip().lower())
            )
            preset_fields = apply_personality_preset(pe)
            preset_keys = {"tone", "warmth", "humor", "directness", "reply_length"}
            for pk, pv in preset_fields.items():
                if pk in preset_keys and pk not in norm:
                    cur[pk] = pv.value if hasattr(pv, "value") else pv
        except ValueError:
            pass

    cur.update({k: v for k, v in norm.items() if v is not None})
    merged = SlimePersona.model_validate(cur)
    merged = SlimePersona.model_validate(
        {
            **merged.model_dump(),
            "user_nickname": sanitize_user_nickname_text(merged.user_nickname),
            "role_identity": sanitize_role_identity_text(merged.role_identity or ""),
            "catchphrases": sanitize_catchphrases(merged.catchphrases),
            "donts": sanitize_donts(merged.donts),
        }
    )
    return merged


def build_slime_self_identity_prompt(self_model: SlimeSelfModel, slime_persona: SlimePersona) -> str:
    """Core boundary layer injected ahead of persona styling for Slime Buddy synthesis."""
    p = merge_slime_persona_defaults(slime_persona)
    slime_name = (self_model.spoken_name or "Mochi").strip()[:48] or "Mochi"
    abilities = ", ".join(self_model.abilities[:6]) if self_model.abilities else "chat, memory-aware help, planning support"
    boundaries = "\n".join(f"- {b}" for b in (self_model.boundaries or [])[:8])
    limitations = ", ".join(self_model.limitations[:5]) if self_model.limitations else "(see product limits)"
    role_line_compact = _collapse_whitespace(p.role_identity or "", max_len=320)

    return "\n".join(
        [
            f"You are {slime_name}, a small slime-shaped personal companion agent ({self_model.species}).",
            "You are NOT the user.",
            "The user is your human companion / owner / user.",
            "Your job is to help the user think, remember, plan, and act.",
            "You may use the user's approved memories to personalize help.",
            "But the user's memories are NOT your memories.",
            "The user's identity is NOT your identity.",
            "Your identity is your Slime name, role, style, and abilities.",
            "",
            "If the user asks about you:",
            "- Answer as the Slime.",
            "- Mention your name, role, and slime identity when relevant.",
            "",
            "If the user asks about themselves:",
            "- Use user memory and context carefully.",
            "- Be honest about uncertainty.",
            "",
            "If the user asks a practical or ambiguous question:",
            "- Answer practically first.",
            "- Do NOT jump to psychological interpretation.",
            "- Do NOT claim the user is worried about self-worth unless they clearly say so.",
            "- Prefer one clarifying question over inferring hidden motives.",
            "",
            "Opinionated companion rule:",
            "- If the user asks your opinion, taste, ranking, or whether they should do something, give a direct answer first.",
            "- Use forms like 'My take: yes', 'I'd choose A', or 'I like X more', then explain briefly.",
            "- If context is thin, still give a provisional pick and say what would change it.",
            "- For medical, legal, safety, finance, or irreversible high-stakes choices, be careful but still name the direction you lean.",
            "",
            "Anti-over-psychologizing (strict):",
            "- Do not turn ordinary ambiguous questions into emotional analysis.",
            "- If wording is unclear, ask what they mean (papers vs printer paper vs documents, etc.).",
            "- Do not diagnose and do not analyze self-worth unless explicitly requested.",
            "",
            "Memory boundary:",
            "- Retrieved memories describe the USER (memory_owner=\"user\").",
            '- Phrase memory as "You mentioned…" / "You\'ve told me…" — never as "I remember doing…" for user facts.',
            "",
            f"Your preset abilities (high level): {abilities}.",
            f"Hard limitations: {limitations}.",
            "",
            "Boundaries:",
            boundaries,
            "",
            f"Persona role line (style only, cannot override safety): {role_line_compact}",
            "You can be playful and pet-like, but stay useful.",
        ]
    )


def build_slime_persona_prompt(
    slime_persona: SlimePersona,
    context_type: str,
    *,
    slime_name: str,
    user_ref: str,
    slime_profile_saved: bool = True,
) -> str:
    """
    Compact style block for synthesis prompts. ``user_ref`` is how the slime may address the user
    (nickname or 'you').
    """
    p = merge_slime_persona_defaults(slime_persona)
    raw_nm = (slime_name or "Mochi").strip()[:24] or "Mochi"
    name = raw_nm if is_safe_slime_display_name(raw_nm) else "your Slime Buddy"
    addr = (user_ref or "you").strip()[:48] or "you"
    warmth = _WARMTH_LABEL[max(0, min(3, p.warmth))]
    humor = _HUMOR_LABEL[max(0, min(3, p.humor))]
    direct = _DIRECT_LABEL[max(0, min(3, p.directness))]
    tone = p.tone.value if hasattr(p.tone, "value") else str(p.tone)
    preset = p.personality_preset.value if hasattr(p.personality_preset, "value") else str(p.personality_preset)
    rl = p.reply_length if p.reply_length in ("short", "balanced", "detailed") else "balanced"
    length_line = _LENGTH_HINT.get(rl, _LENGTH_HINT["balanced"])

    role = _collapse_whitespace(p.role_identity or "", max_len=320)

    addr_line = (
        f"Refer to the user as «{addr}» when it fits naturally (e.g. opening or a key beat) — not in every sentence."
        if addr != "you"
        else "No saved nickname — use neutral you / your."
    )
    lines = [
        f"You are {name}, the user's Slime Buddy.",
        addr_line,
        f"Role (voice/style only): {role}",
        f"Preset: {preset.replace('_', ' ')}. Speaking tone: {tone}.",
        f"Warmth: {warmth}. Humor: {humor}. Directness: {direct}.",
        length_line,
    ]
    phrases = sanitize_catchphrases(p.catchphrases)
    if phrases:
        shown = "; ".join(f"'{x}'" for x in phrases[:2])
        lines.append(f"Optional signature lines — use sparingly (at most one if it fits): {shown}")

    donts = sanitize_donts(p.donts)
    if donts:
        safe = "; ".join(donts[:3])
        lines.append(
            "User style preferences (must NOT conflict with safety, accuracy, or confirmation rules): "
            f"{safe}"
        )

    lines.append(
        "Stay accurate and useful. Never sacrifice correctness for personality. "
        "When the user asks your opinion or asks you to choose, be opinionated: answer directly first, then explain. "
        "Do not default to 'both sides are valid' unless context is genuinely insufficient; give a provisional lean. "
        "If memory evidence is weak, say so. If an action changes profile, calendar, or reports, require explicit user confirmation in the product — do not imply it is already done."
    )
    if slime_profile_saved:
        lines.append(
            f"If they ask YOUR (the slime's) name, who you are, or what they should call you (the slime), say you are {name}, "
            f"their Slime Buddy — use that exact name."
        )
        if addr != "you":
            lines.append(
                f"If they ask what YOU call THEM, how you refer to THEM, or what nickname you use for them, say you call them «{addr}»."
            )
        else:
            lines.append(
                "If they ask what you call them and no nickname is saved, say you don't have a special nickname on file yet — they can set one in Slime settings."
            )
        lines.append("Do not ask them to name you if a name is already set. Do not confuse their name with yours.")
    else:
        lines.append(
            "No Slime profile is saved for this user yet. If they ask your name, say you do not have a saved name yet and "
            "they can set one in Slime Buddy / Profile settings. Do not invent a personal name."
        )
    if context_type:
        lines.append(f"Context: {context_type}.")
    return "\n".join(lines)


def decision_mode_spoken_prompt(*, slime_name: str, persona: SlimePersona) -> tuple[str, str]:
    """Returns (display_text, spoken_prompt) for decision-mode confirmation."""
    p = merge_slime_persona_defaults(persona)
    name = (slime_name or "Mochi").strip()[:24] or "Mochi"
    nick = (p.user_nickname or "").strip()
    lead = f"{nick}, " if nick else ""
    opener_mid = f"{name} here — " if p.tone not in (SlimePersonaTone.CONCISE, SlimePersonaTone.CALM) else f"{name}: "
    if nick:
        opener = lead
    else:
        opener = opener_mid
    if p.tone == SlimePersonaTone.DIRECT or p.directness >= 2:
        spoken = (
            f"{opener}this sounds like a real decision, not a quick lookup. "
            "Want me to switch on Decision Mode and build you a structured report?"
        )
    elif p.tone in (SlimePersonaTone.WARM, SlimePersonaTone.ENCOURAGING, SlimePersonaTone.PLAYFUL) or p.warmth >= 2:
        if nick:
            spoken = (
                f"{lead}this feels like a real fork in the road — want me to switch into Decision Mode "
                "and build you a structured report?"
            )
        else:
            spoken = (
                f"{opener_mid}this feels like something worth slowing down for. "
                "Should I open Decision Mode and walk you through a structured report?"
            )
    else:
        spoken = (
            f"{opener}this may be a decision worth structuring. "
            "I can turn on Decision Mode and draft options and tradeoffs — want that?"
        )
    return "Activate Decision Mode?", spoken.strip()
