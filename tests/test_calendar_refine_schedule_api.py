"""POST /api/calendar/refine-schedule targeted vs full backlog."""

from datetime import datetime

import pytest
from fastapi.testclient import TestClient

import foresight_x.decision_algorithms.scheduler as scheduler_mod
from foresight_x.ui.api_server import app


class _FixedDateTime:
    @staticmethod
    def utcnow():
        return datetime(2026, 5, 11, 12, 0, 0)

    fromisoformat = staticmethod(datetime.fromisoformat)


@pytest.fixture
def fixed_time(monkeypatch):
    monkeypatch.setattr(scheduler_mod, "datetime", _FixedDateTime)


def test_refine_schedule_target_task_ids_only_returns_subset_events(fixed_time):
    tasks = [
        {"id": "a", "title": "Task A", "duration_minutes": 60, "priority": "medium"},
        {"id": "b", "title": "Task B", "duration_minutes": 60, "priority": "medium"},
    ]
    existing = [
        {
            "id": "ai-b",
            "title": "Task B",
            "start": "2026-05-13T15:00:00",
            "end": "2026-05-13T16:00:00",
            "source": "ai",
            "description": "",
            "locked": False,
        },
    ]
    body = {
        "feedback": "please reschedule",
        "tasks": tasks,
        "existing_events": existing,
        "target_task_ids": ["a"],
        "options": {
            "day_start_hour": 9,
            "day_end_hour": 22,
            "slot_minutes": 60,
            "days": 7,
            "min_gap_minutes": 0,
            "max_ai_blocks_per_day": 0,
            "allowed_weekdays": [],
        },
    }
    c = TestClient(app)
    r = c.post("/api/calendar/refine-schedule", json=body)
    assert r.status_code == 200
    data = r.json()
    scheduled = data["schedule"]["scheduled_events"]
    assert len(scheduled) == 1
    assert scheduled[0]["id"] == "ai-a"
    assert "selected" in " ".join(data["notes"]).lower()


def test_refine_schedule_without_targets_schedules_all_tasks(fixed_time):
    tasks = [
        {"id": "a", "title": "Task A", "duration_minutes": 60, "priority": "medium"},
        {"id": "b", "title": "Task B", "duration_minutes": 60, "priority": "medium"},
    ]
    body = {
        "feedback": "pack it",
        "tasks": tasks,
        "existing_events": [],
        "options": {
            "day_start_hour": 9,
            "day_end_hour": 22,
            "slot_minutes": 60,
            "days": 7,
            "min_gap_minutes": 0,
            "max_ai_blocks_per_day": 0,
            "allowed_weekdays": [],
        },
    }
    c = TestClient(app)
    r = c.post("/api/calendar/refine-schedule", json=body)
    assert r.status_code == 200
    assert len(r.json()["schedule"]["scheduled_events"]) == 2
