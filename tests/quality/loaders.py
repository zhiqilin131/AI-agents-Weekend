"""Load YAML/JSON fixtures from tests/quality/."""

from __future__ import annotations

from pathlib import Path

import yaml

from tests.quality.schema import GraphCase, MemoryPrecisionCase, PersonaFixture, QualityE2EScenario

_ROOT = Path(__file__).resolve().parent


def quality_root() -> Path:
    return _ROOT


def load_graph_cases() -> list[GraphCase]:
    out: list[GraphCase] = []
    for path in sorted((_ROOT / "graph_cases").glob("*.yaml")):
        out.append(GraphCase(**yaml.safe_load(path.read_text(encoding="utf-8"))))
    return out


def load_memory_cases() -> list[MemoryPrecisionCase]:
    out: list[MemoryPrecisionCase] = []
    for path in sorted((_ROOT / "memory_cases").glob("*.yaml")):
        out.append(MemoryPrecisionCase(**yaml.safe_load(path.read_text(encoding="utf-8"))))
    return out


def load_e2e_scenarios() -> list[QualityE2EScenario]:
    out: list[QualityE2EScenario] = []
    for path in sorted((_ROOT / "e2e").glob("*.yaml")):
        out.append(QualityE2EScenario(**yaml.safe_load(path.read_text(encoding="utf-8"))))
    return out


def load_persona(persona_id: str) -> PersonaFixture:
    path = _ROOT / "personas" / f"{persona_id}.json"
    return PersonaFixture.model_validate_json(path.read_text(encoding="utf-8"))


def resolve_e2e(spec: str, all_scenarios: list[QualityE2EScenario]) -> list[QualityE2EScenario]:
    spec = spec.strip().lower()
    if spec in ("e2e-smoke", "smoke"):
        return [s for s in all_scenarios if s.id == "fict-sh-01-anxiety-checkin"]
    if spec in ("e2e-core", "core"):
        ids = {
            "fict-rel-01-boundary-after-cheating",
            "fict-career-01-counter-offer-deadline",
            "fict-money-01-parents-loan",
            "fict-health-01-therapy-vs-push",
            "fict-family-01-wedding-attendance",
            "fict-intl-01-return-home",
        }
        return [s for s in all_scenarios if s.id in ids]
    if spec in ("e2e-all", "all"):
        return list(all_scenarios)
    tokens = [x.strip() for x in spec.split(",") if x.strip()]
    by_id = {s.id: s for s in all_scenarios}
    selected: list[QualityE2EScenario] = []
    for token in tokens:
        if token in by_id:
            selected.append(by_id[token])
            continue
        matches = [s for s in all_scenarios if s.id.startswith(token)]
        if len(matches) == 1:
            selected.append(matches[0])
        elif not matches:
            raise ValueError(f"Unknown quality e2e selector: {token}")
        else:
            raise ValueError(f"Ambiguous selector '{token}': {[m.id for m in matches]}")
    return selected
