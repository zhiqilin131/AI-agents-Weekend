"""API surface for Slime model tiers + cost preview."""

from pathlib import Path

from fastapi.testclient import TestClient

from foresight_x.ui.api_server import app


def _tier_env_only_swift(monkeypatch) -> None:
    """Defaults ship several tiers; tests that need a single row blank the rest explicitly."""
    for k in (
        "OPENAI_MODEL_LITTLE",
        "OPENAI_MODEL_SWIFT",
        "OPENAI_MODEL_BALANCED",
        "OPENAI_MODEL_DEEP",
        "OPENAI_MODEL_RESEARCH",
        "OPENAI_MODEL_SLIME_55",
    ):
        monkeypatch.setenv(k, "")
    monkeypatch.setenv("OPENAI_MODEL_SWIFT", "gpt-4.1-nano")


def test_get_models_returns_payload(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    _tier_env_only_swift(monkeypatch)
    c = TestClient(app)
    r = c.get("/api/models")
    assert r.status_code == 200
    data = r.json()
    assert "models" in data and "default_model" in data
    assert isinstance(data["models"], list)
    ids = {m["id"] for m in data["models"]}
    assert "swift" in ids
    assert "balanced" not in ids
    swift = next(m for m in data["models"] if m["id"] == "swift")
    assert swift.get("engine") == "gpt-4.1-nano"


def test_cost_preview_unknown_feature(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    r = c.get("/api/models/cost-preview", params={"feature": "not_a_feature"})
    assert r.status_code == 400


def test_cost_preview_decision_report(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    for k in ("OPENAI_MODEL_LITTLE", "OPENAI_MODEL_BALANCED", "OPENAI_MODEL_RESEARCH", "OPENAI_MODEL_SLIME_55"):
        monkeypatch.setenv(k, "")
    monkeypatch.setenv("OPENAI_MODEL_SWIFT", "gpt-4o-mini")
    monkeypatch.setenv("OPENAI_MODEL_DEEP", "gpt-4o")
    c = TestClient(app)
    r = c.get("/api/models/cost-preview", params={"feature": "decision_report", "model_id": "deep"})
    assert r.status_code == 200
    j = r.json()
    assert j["feature"] == "decision_report"
    assert j["model_id"] == "deep"
    assert j["final_cost"] >= j["base_cost"]
