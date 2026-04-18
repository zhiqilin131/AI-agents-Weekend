"""Tests for Phase 6 CLI output and command flow."""

from __future__ import annotations

from pathlib import Path

from foresight_x.config import Settings
from foresight_x.schemas import DecisionOutcome
from foresight_x.ui import cli


def test_render_trace_sections_has_required_seven_sections(tmp_path: Path) -> None:
    settings = Settings(
        chroma_persist_dir=tmp_path / "chroma",
        foresight_data_dir=tmp_path / "data",
        openai_api_key="",
        tavily_api_key="",
    )
    ctx = cli.PipelineContext(settings=settings, llm=None, user_memory=None, world=None)
    trace = cli.run_pipeline(ctx, "I need to decide about an offer by Friday.", persist_trace=False)

    text = cli.render_trace_sections(trace)
    assert "== Situation ==" in text
    assert "== Insights ==" in text
    assert "== Options ==" in text
    assert "== Trade-offs ==" in text
    assert "== Recommendation ==" in text
    assert "== Actions ==" in text
    assert "== Reflection ==" in text


def test_cli_main_run_pipeline_prints_trace_path(tmp_path: Path, capsys, monkeypatch) -> None:
    settings = Settings(
        chroma_persist_dir=tmp_path / "chroma",
        foresight_data_dir=tmp_path / "data",
        openai_api_key="",
        tavily_api_key="",
    )

    def fake_load_settings() -> Settings:
        return settings

    monkeypatch.setattr(cli, "load_settings", fake_load_settings)
    code = cli.main(["I should choose between two internship offers."])
    assert code == 0
    out = capsys.readouterr().out
    assert "== Situation ==" in out
    assert "Trace saved:" in out


def test_cli_main_record_outcome_flow(tmp_path: Path, capsys, monkeypatch) -> None:
    settings = Settings(
        chroma_persist_dir=tmp_path / "chroma",
        foresight_data_dir=tmp_path / "data",
        openai_api_key="",
        tavily_api_key="",
    )

    def fake_load_settings() -> Settings:
        return settings

    def fake_ask_outcome(decision_id: str, *, settings: Settings) -> DecisionOutcome:
        return DecisionOutcome(
            decision_id=decision_id,
            user_took_recommended_action=True,
            actual_outcome="Good outcome",
            user_reported_quality=4,
            reversed_later=False,
            timestamp="2026-04-18T00:00:00Z",
        )

    monkeypatch.setattr(cli, "load_settings", fake_load_settings)
    monkeypatch.setattr(cli, "ask_outcome", fake_ask_outcome)
    code = cli.main(["--record-outcome", "abc-123"])
    assert code == 0
    out = capsys.readouterr().out
    assert "Outcome saved for abc-123" in out
