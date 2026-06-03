"""Extract feature candidates from simulated futures (not scored until confirmed)."""

from __future__ import annotations

import re

from foresight_x.schemas import SimulatedFuture
from foresight_x.simulation.feature_schemas import FeatureCandidate, FeatureLevel

_PATTERNS: list[tuple[str, FeatureLevel, str]] = [
    (r"income|salary|money|cost|expensive|fee", "money_cost_level", "high"),
    (r"burnout|overwhelm|stress|pressure", "stress_load_level", "high"),
    (r"heavy workload|overtime|intensive|all-nighter", "workload_level", "high"),
    (r"irrevers|cannot undo|no going back", "reversibility_level", "low"),
    (r"growth|upside|promotion|breakthrough", "upside_potential_level", "high"),
    (r"downside|fail|worst case|tail risk", "downside_severity_level", "high"),
    (r"deadline|time pressure|delay|extension", "time_cost_level", "medium"),
]

_QUESTIONS: dict[str, str] = {
    "money_cost_level": "Does this future scenario imply a real money cost for this option?",
    "stress_load_level": "Does this scenario suggest elevated stress if you choose this option?",
    "workload_level": "Does this scenario imply a heavy workload?",
    "reversibility_level": "Does this scenario suggest the choice would be hard to reverse?",
    "upside_potential_level": "Does this scenario suggest meaningful upside?",
    "downside_severity_level": "Does this scenario imply a severe downside?",
    "time_cost_level": "Does this scenario imply significant time cost?",
}


def extract_candidates_from_future(future: SimulatedFuture) -> list[FeatureCandidate]:
    blob = " ".join(
        s.trajectory + " " + " ".join(s.key_drivers) for s in (future.scenarios or [])
    ).lower()
    if not blob.strip():
        return []
    out: list[FeatureCandidate] = []
    seen: set[str] = set()
    for pattern, fkey, level in _PATTERNS:
        if fkey in seen:
            continue
        if re.search(pattern, blob):
            seen.add(fkey)
            out.append(
                FeatureCandidate(
                    option_id=future.option_id,
                    feature_key=fkey,
                    proposed_level=level,  # type: ignore[arg-type]
                    source_type="future_narrative",
                    source_ref=f"future:{future.option_id}",
                    confidence=0.45,
                    note="Pattern matched in simulated future narrative.",
                    confirmation_question=_QUESTIONS.get(fkey, f"Does this future apply to {fkey}?"),
                )
            )
    return out


def extract_candidates_from_futures(futures: list[SimulatedFuture]) -> list[FeatureCandidate]:
    all_c: list[FeatureCandidate] = []
    for fut in futures:
        all_c.extend(extract_candidates_from_future(fut))
    return all_c
