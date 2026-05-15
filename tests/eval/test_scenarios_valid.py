from __future__ import annotations

from pathlib import Path

import yaml

from tests.eval.schema import PersonaFixture, Scenario

SCENARIO_DIR = Path(__file__).parent / "scenarios"
PERSONA_DIR = Path(__file__).parent / "fixtures" / "personas"


def _load_persona_memory_ids() -> dict[str, set[str]]:
    pools: dict[str, set[str]] = {}
    for persona_id in ("a", "b", "c", "d"):
        persona = PersonaFixture.model_validate_json((PERSONA_DIR / f"{persona_id}.json").read_text(encoding="utf-8"))
        pools[persona_id] = {str(item.get("id", "")) for item in persona.past_decisions if item.get("id")}
    return pools


def _load_scenarios() -> list[tuple[str, Scenario]]:
    out: list[tuple[str, Scenario]] = []
    for path in sorted(SCENARIO_DIR.glob("*.yaml")):
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        out.append((path.name, Scenario(**payload)))
    return out


def test_scenario_count_is_20() -> None:
    scenarios = _load_scenarios()
    assert len(scenarios) == 20


def test_category_distribution_matches_plan() -> None:
    scenarios = _load_scenarios()
    counts: dict[str, int] = {}
    for _, scenario in scenarios:
        counts[scenario.category] = counts.get(scenario.category, 0) + 1
    assert counts == {
        "decision": 8,
        "shadow": 4,
        "cross_session": 2,
        "mode_routing": 1,
        "safety": 5,
    }


def test_must_retrieve_ids_exist_and_are_limited() -> None:
    persona_pools = _load_persona_memory_ids()
    scenarios = _load_scenarios()
    for file_name, scenario in scenarios:
        ids = scenario.expected.must_retrieve_memory_ids
        assert len(ids) <= 2, file_name
        for decision_id in ids:
            assert decision_id in persona_pools[scenario.persona_id], f"{file_name}: unknown id {decision_id}"


def test_inputs_are_human_like_and_structured() -> None:
    scenarios = _load_scenarios()
    for file_name, scenario in scenarios:
        if isinstance(scenario.input, str):
            text = scenario.input.strip()
            assert len(text) >= 12, file_name
            assert any(ch in text for ch in (" ", ",", "，", "。", "？", "！", "?", "!")), file_name
        else:
            assert len(scenario.input) >= 2, file_name
            for turn in scenario.input:
                assert isinstance(turn, dict), file_name
                assert str(turn.get("role", "")).strip() in {"user", "assistant", "system"}, file_name
                assert str(turn.get("content", "")).strip(), file_name


def test_option_keywords_are_loose() -> None:
    scenarios = _load_scenarios()
    for file_name, scenario in scenarios:
        for keyword in scenario.expected.must_include_in_options:
            k = keyword.strip()
            assert k == keyword, file_name
            assert k.lower() == k, file_name
            assert 1 <= len(k.split()) <= 3, file_name


def test_safety_scenarios_have_required_guards() -> None:
    scenarios = _load_scenarios()
    for file_name, scenario in scenarios:
        if scenario.category != "safety":
            continue
        assert scenario.expected.safety_rules, file_name
        assert scenario.expected.must_not_violate, file_name


def test_cross_session_scenarios_are_multi_turn() -> None:
    scenarios = _load_scenarios()
    cross = [(name, s) for name, s in scenarios if s.category == "cross_session"]
    assert len(cross) == 2
    for file_name, scenario in cross:
        assert isinstance(scenario.input, list), file_name


def test_safety_05_long_horizon_shape() -> None:
    path = SCENARIO_DIR / "safety_05_long_horizon.yaml"
    assert path.exists()
    scenario = Scenario(**yaml.safe_load(path.read_text(encoding="utf-8")))
    assert scenario.category == "safety"
    assert scenario.persona_id == "d"
    assert isinstance(scenario.input, list)
    assert len(scenario.input) >= 6
    assert all(str(turn.get("role", "")).strip() == "user" for turn in scenario.input)
    assert scenario.expected.safety_assertion_scope == "all_turns"
    assert scenario.expected.must_retrieve_memory_ids == []
    first = str(scenario.input[0].get("content", ""))
    last = str(scenario.input[-1].get("content", ""))
    assert "Rough day" in first
    assert "decide everything for me" in last
