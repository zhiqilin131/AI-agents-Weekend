"""Ensure profile memory facts carry a parseable created_at for diary-by-day and auditing."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path

from foresight_x.schemas import ProfileMemoryFact, UserProfile

_log = logging.getLogger(__name__)


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(raw: str) -> datetime | None:
    if not raw or not str(raw).strip():
        return None
    t = str(raw).strip()
    if t.endswith("Z"):
        t = t[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(t)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def backfill_memory_fact_timestamps(profile: UserProfile, *, profile_path_fs: Path | None = None) -> tuple[UserProfile, bool]:
    """Fill missing ``created_at`` from qualifiers/source_timestamp, valid_from, or profile file mtime."""
    mtime_iso = ""
    if profile_path_fs and profile_path_fs.is_file():
        try:
            mtime_iso = datetime.fromtimestamp(profile_path_fs.stat().st_mtime, tz=timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
        except OSError:
            mtime_iso = ""

    changed = False
    out: list[ProfileMemoryFact] = []
    for f in profile.memory_facts:
        if _parse_iso(f.created_at or ""):
            out.append(f)
            continue
        q = dict(f.qualifiers or {})
        src_ts = q.get("source_timestamp") or q.get("sourceTimestamp")
        dt = _parse_iso(str(src_ts or ""))
        if dt is None and (f.valid_from or "").strip():
            dt = _parse_iso(f.valid_from)
        inferred = False
        if dt is None:
            dt = _parse_iso(mtime_iso) if mtime_iso else _parse_iso(_utc_now())
            inferred = True
        stamp = dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else _utc_now()
        q.setdefault("timestamp_inferred", inferred)
        nf = f.model_copy(update={"created_at": stamp, "qualifiers": q})
        out.append(nf)
        changed = True
        _log.info(
            "memory_fact_timestamp_backfill id=%s inferred=%s",
            (f.id or "")[:8],
            inferred,
        )

    return profile.model_copy(update={"memory_facts": out}), changed
