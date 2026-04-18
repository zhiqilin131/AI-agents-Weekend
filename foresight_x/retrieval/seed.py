"""Load packaged JSON/Markdown seeds into memory and world indices."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from foresight_x.retrieval.memory import UserMemory
from foresight_x.retrieval.world_cache import WorldKnowledge
from foresight_x.schemas import PastDecision


def _seed_dir() -> Path:
    return Path(__file__).resolve().parent / "seeds"


def ingest_memory_json(user_memory: UserMemory, path: Path | None = None) -> int:
    """Insert synthetic past decisions from JSON. Returns number of rows indexed."""
    p = path or _seed_dir() / "memory_demo_user.json"
    data: dict[str, Any] = json.loads(p.read_text(encoding="utf-8"))
    rows = data.get("past_decisions") or []
    global_patterns: list[str] = list(data.get("default_behavioral_patterns") or [])
    count = 0
    allowed = set(PastDecision.model_fields.keys())
    for row in rows:
        payload = {k: row[k] for k in allowed if k in row}
        past = PastDecision.model_validate(payload)
        extra = list(row.get("behavioral_patterns") or []) + global_patterns
        user_memory.add_past_decision(past, behavioral_patterns=extra or None)
        count += 1
    return count


def ingest_world_markdown(world: WorldKnowledge, path: Path | None = None) -> None:
    """Insert static career-domain text as cached facts."""
    p = path or _seed_dir() / "world_career.md"
    if not p.exists():
        return
    text = p.read_text(encoding="utf-8").strip()
    if not text:
        return
    world.insert_text(text, kind="fact", confidence=0.9)
    world.insert_text(
        "Base rate heuristic: many students receive only one strong internship offer per cycle; "
        "asking for a short extension is common and often granted.",
        kind="base_rate",
        confidence=0.7,
    )
