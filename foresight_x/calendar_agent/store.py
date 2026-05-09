"""JSON persistence for calendar drafts and events (per user_id)."""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel, Field

from foresight_x.calendar_agent.schemas import CalendarDraft, CalendarEvent
from foresight_x.config import Settings


class CalendarStoreData(BaseModel):
    events: list[CalendarEvent] = Field(default_factory=list)
    drafts: dict[str, CalendarDraft] = Field(default_factory=dict)


_LOCKS: dict[str, threading.Lock] = {}
_GLOBAL_LOCK = threading.Lock()


def _user_lock(user_id: str) -> threading.Lock:
    with _GLOBAL_LOCK:
        if user_id not in _LOCKS:
            _LOCKS[user_id] = threading.Lock()
        return _LOCKS[user_id]


def _store_path(settings: Settings, user_id: str) -> Path:
    d = settings.foresight_data_dir / "calendar"
    d.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in user_id.strip())[:120]
    return d / f"{safe}.json"


def load_store(settings: Settings, user_id: str) -> CalendarStoreData:
    p = _store_path(settings, user_id)
    if not p.is_file():
        return CalendarStoreData()
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        return CalendarStoreData.model_validate(raw)
    except Exception:
        return CalendarStoreData()


def save_store(settings: Settings, user_id: str, data: CalendarStoreData) -> None:
    p = _store_path(settings, user_id)
    p.write_text(data.model_dump_json(indent=2), encoding="utf-8")


def with_store(settings: Settings, user_id: str, fn):
    lock = _user_lock(user_id)
    with lock:
        data = load_store(settings, user_id)
        out = fn(data)
        save_store(settings, user_id, data)
        return out


def put_draft(settings: Settings, user_id: str, draft: CalendarDraft) -> CalendarDraft:
    def _mut(d: CalendarStoreData) -> CalendarDraft:
        d.drafts[draft.draft_id] = draft
        return draft

    lock = _user_lock(user_id)
    with lock:
        data = load_store(settings, user_id)
        draft = _mut(data)
        save_store(settings, user_id, data)
        return draft


def get_draft(settings: Settings, user_id: str, draft_id: str) -> CalendarDraft | None:
    data = load_store(settings, user_id)
    return data.drafts.get(draft_id)


def delete_draft(settings: Settings, user_id: str, draft_id: str) -> None:
    lock = _user_lock(user_id)
    with lock:
        data = load_store(settings, user_id)
        data.drafts.pop(draft_id, None)
        save_store(settings, user_id, data)


def list_events(settings: Settings, user_id: str) -> list[CalendarEvent]:
    return list(load_store(settings, user_id).events)


def replace_events(settings: Settings, user_id: str, events: list[CalendarEvent]) -> None:
    lock = _user_lock(user_id)
    with lock:
        data = load_store(settings, user_id)
        data.events = events
        save_store(settings, user_id, data)


def upsert_event(settings: Settings, user_id: str, event: CalendarEvent) -> CalendarEvent:
    lock = _user_lock(user_id)
    with lock:
        data = load_store(settings, user_id)
        rest = [e for e in data.events if e.id != event.id]
        rest.append(event)
        data.events = rest
        save_store(settings, user_id, data)
        return event


def delete_event(settings: Settings, user_id: str, event_id: str) -> bool:
    lock = _user_lock(user_id)
    with lock:
        data = load_store(settings, user_id)
        before = len(data.events)
        data.events = [e for e in data.events if e.id != event_id]
        save_store(settings, user_id, data)
        return len(data.events) < before


def new_draft_id() -> str:
    return f"cd-{uuid.uuid4().hex[:12]}"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
