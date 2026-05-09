"""Aggregate per-day signals from existing stores only (no duplicate source-of-truth)."""

from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from foresight_x.calendar_agent.store import load_store
from foresight_x.chat.thread_store import _user_thread_dir  # noqa: SLF001 — reuse layout contract
from foresight_x.config import Settings, load_settings
from foresight_x.diary.schemas import (
    CalendarItemRef,
    ChatMessageRef,
    DecisionReportRef,
    DiarySourceBundle,
    DiarySourceDiagnostics,
    DiarySourceRefs,
    ImportedContextRef,
    MemoryFactRef,
    VoiceTurnRef,
)
from foresight_x.harness.trace_index import list_traces
from foresight_x.profile.memory_timestamp_backfill import backfill_memory_fact_timestamps
from foresight_x.profile.store import load_user_profile, profile_path, save_user_profile
from foresight_x.schemas import ProfileMemoryFact

_log = logging.getLogger(__name__)


def _safe_user_segment(user_id: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in user_id.strip())[:120]


def _parse_iso_timestamp(raw: str) -> datetime | None:
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


def _resolve_tz(name: str) -> ZoneInfo:
    n = (name or "").strip() or "UTC"
    try:
        return ZoneInfo(n)
    except Exception:
        return ZoneInfo("UTC")


def _local_date(dt: datetime, tz: ZoneInfo) -> date:
    return dt.astimezone(tz).date()


def _target_date(date_str: str) -> date:
    y, m, d = (int(x) for x in date_str.split("-"))
    return date(y, m, d)


def _preview_text(text: str, n: int = 220) -> str:
    s = " ".join(str(text or "").split())
    return (s[:n] + "…") if len(s) > n else s


def _is_voice_message(thread: dict[str, Any], msg: dict[str, Any]) -> bool:
    if (thread.get("source") or "") == "slime_voice":
        return True
    meta = msg.get("metadata") if isinstance(msg.get("metadata"), dict) else {}
    if (meta.get("interaction_source") or "") == "slime_voice":
        return True
    if str(meta.get("modality") or "").lower() == "voice":
        return True
    return False


def _collect_chat_and_voice(
    user_id: str,
    target: date,
    tz: ZoneInfo,
) -> tuple[list[ChatMessageRef], list[VoiceTurnRef], list[str], list[str], int]:
    chat_refs: list[ChatMessageRef] = []
    voice_refs: list[VoiceTurnRef] = []
    thread_ids: list[str] = []
    message_ids: list[str] = []
    skipped_no_ts = 0

    root = _user_thread_dir(user_id)
    if not root.is_dir():
        return chat_refs, voice_refs, thread_ids, message_ids, skipped_no_ts

    for path in sorted(root.glob("*.json")):
        try:
            thread = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        tid = str(thread.get("thread_id") or "")
        if not tid:
            continue
        thread_hit = False
        for msg in thread.get("messages") or []:
            if not isinstance(msg, dict):
                continue
            created = str(msg.get("created_at") or "")
            dt = _parse_iso_timestamp(created)
            if dt is None:
                if (msg.get("content") or "").strip():
                    skipped_no_ts += 1
                continue
            if _local_date(dt, tz) != target:
                continue
            mid = str(msg.get("id") or "")
            role = str(msg.get("role") or "")
            content = str(msg.get("content") or "")
            voice = _is_voice_message(thread, msg)
            preview = _preview_text(content, 360)
            if mid:
                message_ids.append(mid)
            thread_hit = True
            chat_refs.append(
                ChatMessageRef(
                    thread_id=tid,
                    message_id=mid,
                    created_at=created,
                    role=role,
                    preview=preview,
                    is_voice_turn=voice,
                )
            )
            if voice:
                voice_refs.append(
                    VoiceTurnRef(thread_id=tid, message_id=mid, created_at=created, preview=preview)
                )

        if thread_hit and tid not in thread_ids:
            thread_ids.append(tid)

    thread_ids = list(dict.fromkeys(thread_ids))
    message_ids = list(dict.fromkeys(message_ids))
    return chat_refs, voice_refs, thread_ids, message_ids, skipped_no_ts


def _collect_temporary_imports(
    user_id: str,
    target: date,
    tz: ZoneInfo,
) -> list[ImportedContextRef]:
    out: list[ImportedContextRef] = []
    root = _user_thread_dir(user_id)
    if not root.is_dir():
        return out
    for path in root.glob("*.json"):
        try:
            thread = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        tid = str(thread.get("thread_id") or "").strip()
        for item in thread.get("temporary_context") or []:
            if not isinstance(item, dict):
                continue
            icreated = str(item.get("created_at") or "")
            idt = _parse_iso_timestamp(icreated)
            if idt is None or _local_date(idt, tz) != target:
                continue
            iid = str(item.get("id") or "").strip()
            text = str(item.get("text") or "").strip()
            if iid and text:
                out.append(
                    ImportedContextRef(
                        kind="temporary_context",
                        id=iid,
                        preview=_preview_text(text, 280),
                        thread_id=tid or None,
                    )
                )
    return out


def _collect_decisions(
    settings: Settings,
    target: date,
    tz: ZoneInfo,
) -> tuple[list[DecisionReportRef], list[str]]:
    refs: list[DecisionReportRef] = []
    ids: list[str] = []
    for row in list_traces(settings=settings):
        dt = _parse_iso_timestamp(row.timestamp)
        if dt is None or _local_date(dt, tz) != target:
            continue
        refs.append(
            DecisionReportRef(
                decision_id=row.decision_id,
                timestamp=row.timestamp,
                preview=str(row.preview or ""),
            )
        )
        ids.append(row.decision_id)
    return refs, ids


def _calendar_event_hits_target(ev_start: str, ev_end: str, target: date, tz: ZoneInfo) -> bool:
    s_dt = _parse_iso_timestamp(ev_start)
    e_dt = _parse_iso_timestamp(ev_end)
    if s_dt is None:
        return False
    if e_dt is None:
        e_dt = s_dt
    s_day = _local_date(s_dt, tz)
    e_day = _local_date(e_dt, tz)
    return s_day <= target <= e_day


def _collect_calendar(
    settings: Settings,
    user_id: str,
    target: date,
    tz: ZoneInfo,
) -> tuple[list[CalendarItemRef], list[str], list[str]]:
    items: list[CalendarItemRef] = []
    event_ids: list[str] = []
    draft_ids: list[str] = []
    data = load_store(settings, _safe_user_segment(user_id))
    for ev in data.events:
        if _calendar_event_hits_target(ev.start, ev.end, target, tz):
            items.append(
                CalendarItemRef(
                    kind="event",
                    id=ev.id,
                    title=ev.title,
                    start=ev.start,
                    end=ev.end,
                )
            )
            event_ids.append(ev.id)
    for did, draft in data.drafts.items():
        hit = False
        if draft.created_at:
            cdt = _parse_iso_timestamp(draft.created_at)
            if cdt is not None and _local_date(cdt, tz) == target:
                hit = True
        for pe in draft.proposed_events or []:
            if _calendar_event_hits_target(pe.start, pe.end, target, tz):
                hit = True
                break
        if hit:
            title = ""
            if draft.intent and draft.intent.title:
                title = str(draft.intent.title)
            items.append(CalendarItemRef(kind="draft", id=did, title=title, start="", end=""))
            draft_ids.append(did)
    return items, event_ids, draft_ids


def _active_memory_facts(profile_facts: list[ProfileMemoryFact]) -> list[ProfileMemoryFact]:
    return [f for f in profile_facts if (f.status or "active") != "deprecated"]


def _memory_facts_for_target_day(
    facts: list[ProfileMemoryFact],
    target: date,
    tz: ZoneInfo,
    chat_keywords: set[str],
) -> tuple[list[MemoryFactRef], int]:
    """Match memories by created_at / updated_at / valid_from local day, import day, or keyword overlap."""

    def _words(s: str) -> set[str]:
        return {w for w in re.findall(r"[a-zA-Z]{4,}", s.lower())}

    refs: list[MemoryFactRef] = []
    seen: set[str] = set()
    matched_count = 0

    for f in facts:
        fid = (f.id or "").strip()
        if not fid:
            continue
        text = (f.text or "").strip()
        src = str(f.source or "")
        include = False

        ca = _parse_iso_timestamp(f.created_at or "")
        if ca is not None and _local_date(ca, tz) == target:
            include = True

        ua_str = str(getattr(f, "updated_at", "") or "").strip()
        ua = _parse_iso_timestamp(ua_str)
        if ua is not None and _local_date(ua, tz) == target:
            include = True

        vf = (f.valid_from or "").strip()
        if vf:
            d0 = _parse_iso_timestamp(vf)
            if d0 is not None and _local_date(d0, tz) == target:
                include = True

        if src == "import":
            created = _parse_iso_timestamp(f.created_at or "")
            if created is not None and _local_date(created, tz) == target:
                include = True

        if not include and chat_keywords:
            fw = _words(text)
            if fw & chat_keywords:
                include = True

        if include and fid not in seen:
            seen.add(fid)
            refs.append(MemoryFactRef(memory_id=fid, text_preview=_preview_text(text, 320), source=src))
            matched_count += 1

    return refs, matched_count


def collect_diary_sources_for_date(
    user_id: str,
    date: str,
    timezone_name: str,
    *,
    settings: Settings | None = None,
) -> DiarySourceBundle:
    """
    Read-only aggregation across chat threads, traces, calendar JSON, and profile memory facts.
    Returns compact refs — full messages/events remain in their native stores.
    """
    s = settings or load_settings()
    s_user = s.model_copy(update={"foresight_user_id": user_id})
    tz = _resolve_tz(timezone_name)
    target = _target_date(date)

    diagnostics = DiarySourceDiagnostics()

    profile_raw = load_user_profile(s_user)
    undated_before = sum(
        1
        for f in _active_memory_facts(list(profile_raw.memory_facts))
        if not _parse_iso_timestamp(f.created_at or "") and not _parse_iso_timestamp((f.valid_from or "").strip())
    )
    diagnostics.undated_memory_records_before_backfill = undated_before

    pp = profile_path(s_user)
    profile, backfilled = backfill_memory_fact_timestamps(
        profile_raw,
        profile_path_fs=pp if pp.is_file() else None,
    )
    diagnostics.profile_memory_facts_backfilled = backfilled
    if backfilled:
        save_user_profile(profile, settings=s_user)

    still_bad = sum(
        1 for f in _active_memory_facts(list(profile.memory_facts)) if not _parse_iso_timestamp(f.created_at or "")
    )
    diagnostics.memory_records_still_without_created_at = still_bad
    if still_bad:
        _log.warning(
            "%d profile memory facts still lack created_at after backfill; diary date assignment may miss them",
            still_bad,
        )

    if undated_before:
        _log.warning(
            "Memory items missing timestamp before backfill; cannot assign to diary date without inference (%d rows)",
            undated_before,
        )

    chat_msgs, voice_turns, thread_ids_msg, message_ids, skipped_msgs = _collect_chat_and_voice(
        user_id, target, tz
    )
    diagnostics.skipped_chat_messages_no_timestamp = skipped_msgs

    decision_refs, decision_ids = _collect_decisions(s_user, target, tz)
    cal_refs, cal_event_ids, cal_draft_ids = _collect_calendar(s, user_id, target, tz)

    facts = _active_memory_facts(list(profile.memory_facts))
    chat_kw: set[str] = set()
    for m in chat_msgs:
        chat_kw |= {w for w in re.findall(r"[a-zA-Z]{4,}", (m.preview or "").lower())}
    mem_refs, mem_matched = _memory_facts_for_target_day(facts, target, tz, chat_kw)
    diagnostics.memory_records_matched_for_day = mem_matched

    import_rows = [
        ImportedContextRef(kind="memory_fact", id=m.memory_id, preview=m.text_preview)
        for m in mem_refs
        if (m.source or "") == "import"
    ]
    temp_imports = _collect_temporary_imports(user_id, target, tz)
    imported_context = import_rows + temp_imports
    import_ids = [x.id for x in import_rows] + [x.id for x in temp_imports]

    thread_ids = list(
        dict.fromkeys(
            [
                *thread_ids_msg,
                *[m.thread_id for m in chat_msgs],
                *[x.thread_id for x in imported_context if x.thread_id],
            ]
        )
    )
    bundle_refs = DiarySourceRefs(
        thread_ids=thread_ids,
        message_ids=message_ids,
        decision_ids=list(dict.fromkeys(decision_ids)),
        calendar_event_ids=list(dict.fromkeys(cal_event_ids)),
        calendar_draft_ids=list(dict.fromkeys(cal_draft_ids)),
        memory_ids=[m.memory_id for m in mem_refs],
        import_ids=list(dict.fromkeys([x for x in import_ids if x])),
    )

    return DiarySourceBundle(
        date=date,
        timezone=timezone_name or "UTC",
        diagnostics=diagnostics,
        chat_messages=chat_msgs,
        voice_turns=voice_turns,
        decision_reports=decision_refs,
        calendar_items=cal_refs,
        approved_memories=mem_refs,
        imported_context=imported_context,
        source_refs=bundle_refs,
    )


def bundle_has_activity(bundle: DiarySourceBundle) -> bool:
    c = bundle.counts()
    return (
        c.chat_messages
        + c.voice_turns
        + c.reports
        + c.calendar_items
        + c.memory_refs
        + c.imported_items
    ) > 0
