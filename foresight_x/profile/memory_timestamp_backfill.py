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
    """Fill missing ``created_at`` for diary-by-day and auditing.

    ``created_at`` means **when this fact was recorded** (or tied to a trusted message time),
    not the historical date mentioned inside the fact text and not ``valid_from`` semantics
    (validity / biography dates like \"started job in 2023\").

    Preference order: explicit ``created_at`` → trusted ``source_timestamp`` (imports / message-linked only)
    → profile file mtime → UTC now.
    """
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
        raw_ts = q.get("source_timestamp") or q.get("sourceTimestamp")
        src_ts = str(raw_ts or "").strip()
        trust_ts = False
        if src_ts:
            src = (f.source or "").strip().lower()
            if src == "import":
                trust_ts = True
            elif q.get("timestamp_from_message") or q.get("thread_message_created_at"):
                trust_ts = True
        dt = _parse_iso(src_ts) if trust_ts else None
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
