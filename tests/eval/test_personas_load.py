from __future__ import annotations

from pathlib import Path

import pytest

from foresight_x.config import Settings
from foresight_x.profile.store import load_user_profile, profile_path
from tests.eval.schema import PersonaFixture

PERSONA_DIR = Path(__file__).parent / "fixtures" / "personas"
EXPECTED_COUNTS = {"a": 2, "b": 6, "c": 1, "d": 3}


def load_persona(persona_id: str) -> PersonaFixture:
    path = PERSONA_DIR / f"{persona_id}.json"
    return PersonaFixture.model_validate_json(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("persona_id", ["a", "b", "c", "d"])
def test_persona_loads_into_pipeline(persona_id: str, tmp_path: Path) -> None:
    persona = load_persona(persona_id)
    settings = Settings(
        foresight_data_dir=tmp_path,
        foresight_user_id=f"eval_persona_{persona_id}",
        supabase_url="",
        supabase_service_role_key="",
    )
    path = profile_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(persona.model_dump_json(indent=2), encoding="utf-8")
    profile = load_user_profile(settings=settings)
    assert profile.user_priorities or profile.priorities
    assert len(persona.past_decisions) == EXPECTED_COUNTS[persona_id]
