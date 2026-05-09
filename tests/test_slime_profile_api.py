from pathlib import Path

from fastapi.testclient import TestClient

from foresight_x.profile.store import load_user_profile
from foresight_x.ui.api_server import app


def test_default_slime_profile_when_missing(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    r = c.get("/api/profile/slime")
    assert r.status_code == 200
    body = r.json()
    assert body["color_theme"] == "violet"
    assert body["personality"] == "calm"
    assert body["shape"] == "classic"
    assert body["accessory"] == "none"
    assert body["motion"] == "normal"


def test_update_slime_profile_validates_enums(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    bad = c.patch("/api/profile/slime", json={"personality": "hyper"})
    assert bad.status_code == 400
    assert "invalid_slime_profile_patch" in str(bad.json().get("detail"))


def test_name_length_limited(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    long_name = "x" * 60
    r = c.patch("/api/profile/slime", json={"name": long_name})
    assert r.status_code == 200
    assert len(r.json()["name"]) == 24


def test_custom_colors_sanitized(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    bad = c.patch(
        "/api/profile/slime",
        json={"customColors": {"primary": "red;position:fixed", "secondary": "#00ff00", "glow": "#ffffff"}},
    )
    assert bad.status_code == 400
    ok = c.patch(
        "/api/profile/slime",
        json={"customColors": {"primary": "#11aaee", "secondary": "#3300ff", "glow": "#99ccff"}},
    )
    assert ok.status_code == 200
    body = ok.json()
    assert body["color_theme"] == "custom"
    assert body["custom_colors"]["primary"] == "#11aaee"


def test_spark_accessory_persists(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    r = c.patch("/api/profile/slime", json={"accessory": "spark", "colorTheme": "aurora"})
    assert r.status_code == 200
    assert r.json()["accessory"] == "spark"
    loaded = load_user_profile()
    assert loaded.slime_profile is not None
    assert loaded.slime_profile.accessory.value == "spark"


def test_profile_persists_slime_profile(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    r = c.patch(
        "/api/profile/slime",
        json={"name": "Mochi", "colorTheme": "mint", "shape": "robot", "accessory": "halo", "motion": "expressive"},
    )
    assert r.status_code == 200
    loaded = load_user_profile()
    assert loaded.slime_profile is not None
    assert loaded.slime_profile.color_theme.value == "mint"
    assert loaded.slime_profile.shape.value == "robot"
