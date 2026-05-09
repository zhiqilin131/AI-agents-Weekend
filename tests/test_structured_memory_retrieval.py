from __future__ import annotations

import json
from pathlib import Path

from llama_index.core.embeddings import MockEmbedding

from foresight_x.config import Settings
from foresight_x.retrieval.memory import (
    MemoryCandidate,
    UserMemory,
    _candidate_theme,
    _blend_legacy_with_rrf,
    _dedupe_candidates_by_decision_id,
    _should_expand_low_confidence_selection,
    _select_diverse_memory_candidates,
)
from foresight_x.retrieval.memory_evidence import expand_selected_memories_to_evidence
from foresight_x.schemas import PastDecision, Reversibility, TimePressure, UserState


def _cand(
    did: str | None,
    score: float,
    *,
    text: str = "hello world",
    md: dict | None = None,
) -> MemoryCandidate:
    c = MemoryCandidate(
        decision_id=did,
        text=text,
        metadata=md or {},
        similarity_score=score,
        fused_score=score,
        theme="general",
        timestamp=None,
        outcome_quality=None,
    )
    c.theme = _candidate_theme(c)
    return c


def test_dedupe_candidates_keeps_highest_fused_score() -> None:
    xs = [
        _cand("d-1", 0.41, text="first"),
        _cand("d-1", 0.88, text="second"),
        _cand("d-2", 0.55, text="third"),
    ]
    out = _dedupe_candidates_by_decision_id(xs)
    by_id = {x.decision_id: x for x in out}
    assert set(by_id) == {"d-1", "d-2"}
    assert by_id["d-1"].fused_score == 0.88


def test_candidate_theme_priority_and_fallback() -> None:
    assert _candidate_theme(_cand("a", 0.5, md={"decision_type": "career"})) == "career"
    assert _candidate_theme(_cand("a", 0.5, md={"domain": "health"})) == "health"
    assert _candidate_theme(_cand("a", 0.5, md={"behavioral_patterns_json": '["avoid conflict"]'})) == "avoid conflict"
    assert _candidate_theme(_cand("a", 0.5, md={})) == "general"


def test_diverse_selection_spreads_themes_when_possible() -> None:
    cands: list[MemoryCandidate] = []
    for i in range(10):
        cands.append(_cand(f"career-{i}", 0.95 - i * 0.01, text=f"career role offer {i}", md={"decision_type": "career"}))
    cands.append(_cand("health-1", 0.83, text="health treatment choice", md={"decision_type": "health"}))
    cands.append(_cand("money-1", 0.82, text="finance budget tradeoff", md={"decision_type": "financial"}))
    selected = _select_diverse_memory_candidates(cands, top_k=5, max_per_theme=2)
    themes = {x.theme for x in selected}
    assert len(selected) == 5
    assert len(themes) >= 2


def test_evidence_expansion_handles_existing_and_missing_trace(tmp_path: Path) -> None:
    traces = tmp_path / "traces"
    traces.mkdir(parents=True, exist_ok=True)
    payload = {
        "decision_id": "d-100",
        "timestamp": "2026-01-01T00:00:00Z",
        "original_user_input": "Should I move city?",
        "user_state": {"raw_input": "Should I move city for new role?"},
        "recommendation": {"chosen_option_id": "opt-1", "reasoning": "career upside"},
    }
    (traces / "d-100.json").write_text(json.dumps(payload), encoding="utf-8")
    selected = [
        _cand("d-100", 0.91, text="move city decision", md={"decision_type": "career"}),
        _cand("d-404", 0.81, text="missing trace", md={"decision_type": "general"}),
    ]
    rows = expand_selected_memories_to_evidence(selected, traces)
    assert len(rows) == 2
    assert any(r["decision_id"] == "d-100" and r["source_excerpt"] for r in rows)
    assert any(r["decision_id"] == "d-404" for r in rows)


def test_retrieve_backward_compatible_bundle_shape(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("CHROMA_PERSIST_DIR", str(tmp_path / "chroma"))
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path / "data"))
    settings = Settings()
    mem = UserMemory("u_struct", settings=settings, embed_model=MockEmbedding(embed_dim=1536))
    mem.add_past_decision(
        PastDecision(
            decision_id="d1",
            situation_summary="career offer A vs B",
            chosen_option="A",
            outcome="accepted A",
            outcome_quality=4,
            timestamp="2026-02-01T00:00:00Z",
        ),
        decision_type="career",
    )
    state = UserState(
        raw_input="offer decision",
        goals=["career growth"],
        time_pressure=TimePressure.MEDIUM,
        stress_level=5,
        workload=4,
        current_behavior="deciding",
        decision_type="career",
        reversibility=Reversibility.PARTIAL,
    )
    out = mem.retrieve(state, top_k=3)
    assert hasattr(out, "similar_past_decisions")
    assert hasattr(out, "behavioral_patterns")
    assert hasattr(out, "prior_outcomes_summary")
    assert isinstance(out.similar_past_decisions, list)


def test_graph_boost_prefers_graph_supported_candidate(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("CHROMA_PERSIST_DIR", str(tmp_path / "chroma"))
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path / "data"))
    settings = Settings()
    mem = UserMemory("u_graph", settings=settings, embed_model=MockEmbedding(embed_dim=1536))
    mem.add_past_decision(
        PastDecision(
            decision_id="d_graph",
            situation_summary="career role interview pipeline",
            chosen_option="interview",
            outcome="good",
            outcome_quality=4,
            timestamp="2026-03-01T00:00:00Z",
        ),
        decision_type="career",
    )
    mem.add_past_decision(
        PastDecision(
            decision_id="d_plain",
            situation_summary="career role interview pipeline similar",
            chosen_option="decline",
            outcome="ok",
            outcome_quality=3,
            timestamp="2026-03-01T00:00:00Z",
        ),
        decision_type="career",
    )
    state = UserState(
        raw_input="career interview role choice",
        goals=["fit"],
        time_pressure=TimePressure.MEDIUM,
        stress_level=4,
        workload=4,
        current_behavior="careful",
        decision_type="career",
        reversibility=Reversibility.PARTIAL,
    )
    out = mem.retrieve(
        state,
        top_k=1,
        graph_decision_ids=["d_graph"],
        graph_scores={"d_graph": 0.9},
    )
    assert out.similar_past_decisions
    assert out.similar_past_decisions[0].decision_id == "d_graph"


def test_rrf_blend_can_promote_consensus_candidate() -> None:
    cands = [
        _cand("a", 0.91, text="career offer growth", md={"decision_type": "career"}),
        _cand("b", 0.86, text="career offer growth salary", md={"decision_type": "career"}),
        _cand("c", 0.84, text="budget debt risk", md={"decision_type": "financial"}),
    ]
    # lexical/recency rank signals favor b slightly more than a.
    lex = {
        "0:career offer growth:a": 0.2,
        "1:career offer growth salary:b": 0.9,
        "2:budget debt risk:c": 0.1,
    }
    rec = {
        "0:career offer growth:a": 0.3,
        "1:career offer growth salary:b": 0.8,
        "2:budget debt risk:c": 0.2,
    }
    out = _blend_legacy_with_rrf(cands, lex, rec, rrf_blend=0.3)
    by_id = {x.decision_id: x for x in out}
    assert by_id["b"].fused_score > 0.86
    assert by_id["b"].fused_score > by_id["c"].fused_score


def test_low_confidence_expansion_trigger() -> None:
    selected = [
        _cand("d1", 0.501, text="x one"),
        _cand("d2", 0.492, text="x two"),
        _cand("d3", 0.487, text="x three"),
    ]
    assert _should_expand_low_confidence_selection(selected) is True
