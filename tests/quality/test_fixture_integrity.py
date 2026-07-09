"""Validate fictional personas and E2E YAML fixtures — $0, no API."""

from __future__ import annotations

from pathlib import Path

import yaml

from foresight_x.schemas import UserProfile

from tests.quality.loaders import load_e2e_scenarios, load_graph_cases, load_memory_cases, quality_root
from tests.quality.schema import PersonaFixture


def test_all_personas_match_user_profile_schema() -> None:
    persona_dir = quality_root() / "personas"
    for path in sorted(persona_dir.glob("*.json")):
        raw = path.read_text(encoding="utf-8")
        persona = PersonaFixture.model_validate_json(raw)
        # Round-trip through UserProfile (what e2e seeding actually uses).
        profile_payload = persona.model_dump(mode="json", exclude={"past_decisions"})
        UserProfile.model_validate(profile_payload)


def test_e2e_persona_references_exist() -> None:
    persona_ids = {p.stem for p in (quality_root() / "personas").glob("*.json")}
    for scenario in load_e2e_scenarios():
        assert scenario.persona_id in persona_ids, f"{scenario.id} references missing persona {scenario.persona_id}"


def test_e2e_past_decision_ids_referenced() -> None:
    personas = {
        p.stem: PersonaFixture.model_validate_json(p.read_text(encoding="utf-8"))
        for p in (quality_root() / "personas").glob("*.json")
    }
    for scenario in load_e2e_scenarios():
        pd_ids = {str(r.get("id", "")) for r in personas[scenario.persona_id].past_decisions}
        for mem_id in scenario.expected.must_retrieve_memory_ids:
            assert mem_id in pd_ids, f"{scenario.id} expects {mem_id} not in persona past_decisions"


def test_graph_and_memory_fixtures_load() -> None:
    assert len(load_graph_cases()) >= 8
    assert len(load_memory_cases()) >= 4


def test_e2e_yaml_parse() -> None:
    for path in sorted((quality_root() / "e2e").glob("*.yaml")):
        yaml.safe_load(path.read_text(encoding="utf-8"))
