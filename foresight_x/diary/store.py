"""JSON persistence for diary entries (one file per user per calendar day)."""

from __future__ import annotations

import calendar
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from foresight_x.config import Settings
from foresight_x.diary.schemas import DiaryEntry, DiaryMonthSummaryItem


def _safe_user_segment(user_id: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in user_id.strip())[:120]


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _user_diary_dir(settings: Settings, user_id: str) -> Path:
    d = settings.foresight_data_dir / "diary" / _safe_user_segment(user_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def entry_path(settings: Settings, user_id: str, date_str: str) -> Path:
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str or ""):
        raise ValueError("date must be YYYY-MM-DD")
    return _user_diary_dir(settings, user_id) / f"{date_str}.json"


def load_entry(settings: Settings, user_id: str, date_str: str) -> DiaryEntry | None:
    p = entry_path(settings, user_id, date_str)
    if not p.is_file():
        return None
    try:
        return DiaryEntry.model_validate_json(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, ValueError, OSError):
        return None


def save_entry(settings: Settings, user_id: str, entry: DiaryEntry) -> Path:
    p = entry_path(settings, user_id, entry.date)
    payload = entry.model_dump(mode="json")
    payload["memory_indexed"] = False
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


def load_entry_by_id(settings: Settings, user_id: str, entry_id: str) -> DiaryEntry | None:
    root = _user_diary_dir(settings, user_id)
    for path in root.glob("*.json"):
        try:
            e = DiaryEntry.model_validate_json(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, ValueError, OSError):
            continue
        if e.id == entry_id:
            return e
    return None


def list_month_summaries(settings: Settings, user_id: str, month: str) -> list[DiaryMonthSummaryItem]:
    """month = YYYY-MM; returns every calendar day in the month."""
    if not re.match(r"^\d{4}-\d{2}$", month or ""):
        raise ValueError("month must be YYYY-MM")
    y, m = (int(month[:4]), int(month[5:7]))
    _, last_day = calendar.monthrange(y, m)
    out: list[DiaryMonthSummaryItem] = []
    root = _user_diary_dir(settings, user_id)
    for day in range(1, last_day + 1):
        ds = f"{y:04d}-{m:02d}-{day:02d}"
        p = root / f"{ds}.json"
        if not p.is_file():
            out.append(DiaryMonthSummaryItem(date=ds, has_entry=False))
            continue
        try:
            e = DiaryEntry.model_validate_json(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, ValueError, OSError):
            out.append(DiaryMonthSummaryItem(date=ds, has_entry=False))
            continue
        preview = (e.summary or "").strip().replace("\n", " ")
        if len(preview) > 140:
            preview = preview[:137] + "…"
        out.append(
            DiaryMonthSummaryItem(
                date=ds,
                id=e.id,
                has_entry=True,
                title=e.title or "Diary",
                tone=e.tone,
                summary_preview=preview,
            )
        )
    return out


def new_entry_id() -> str:
    return str(uuid.uuid4())


def stamp_times(entry: DiaryEntry, *, created: bool) -> DiaryEntry:
    now = _utc_now()
    if created or not (entry.created_at or "").strip():
        return entry.model_copy(update={"created_at": now, "updated_at": now})
    return entry.model_copy(update={"updated_at": now})
