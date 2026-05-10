from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from foresight_x.config import load_settings
from foresight_x.perception.clarification_gate import default_clarification_state


class ThreadNotFoundError(KeyError):
    """No saved thread JSON for this ``user_id`` + ``thread_id`` (and caller forbids auto-create)."""


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _thread_dir() -> Path:
    s = load_settings()
    p = s.foresight_data_dir / "chat_threads"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _user_thread_dir(user_id: str) -> Path:
    p = _thread_dir() / user_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def _thread_path(user_id: str, thread_id: str) -> Path:
    return _user_thread_dir(user_id) / f"{thread_id}.json"


def _default_title(first_message: str = "") -> str:
    t = (first_message or "").strip()
    if not t:
        return "New chat"
    x = " ".join(t.split())
    return x[:64] + ("..." if len(x) > 64 else "")


def create_thread(*, user_id: str, title: str | None = None) -> dict[str, Any]:
    tid = str(uuid.uuid4())
    t = {
        "thread_id": tid,
        "user_id": user_id,
        "title": title or "New chat",
        "created_at": _now(),
        "updated_at": _now(),
        "mode": "normal",
        "messages": [],
        "memory_events": [],
        "dismissed_suggestions": {"role_mode": False, "decision_report": False},
        "linked_decision_ids": [],
        "working_summary": "",
        "temporary_context": [],
        "clarification_events": [],
        "clarification_state": default_clarification_state(),
    }
    save_thread(t)
    return t


def list_threads(*, user_id: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    d = _user_thread_dir(user_id)
    for p in sorted(d.glob("*.json"), reverse=True):
        try:
            t = json.loads(p.read_text(encoding="utf-8"))
            out.append(
                {
                    "thread_id": t.get("thread_id"),
                    "title": t.get("title") or "New chat",
                    "updated_at": t.get("updated_at"),
                    "created_at": t.get("created_at"),
                    "mode": t.get("mode", "normal"),
                    "message_count": len(t.get("messages", [])),
                }
            )
        except Exception:
            continue
    return sorted(out, key=lambda x: str(x.get("updated_at") or ""), reverse=True)


def load_thread(thread_id: str | None, *, user_id: str, allow_create: bool = True) -> dict[str, Any]:
    if not thread_id:
        if not allow_create:
            raise ThreadNotFoundError("missing thread_id")
        return create_thread(user_id=user_id)
    p = _thread_path(user_id, thread_id)
    if not p.is_file():
        if not allow_create:
            raise ThreadNotFoundError(thread_id)
        return create_thread(user_id=user_id)
    try:
        t = json.loads(p.read_text(encoding="utf-8"))
        if not t.get("user_id"):
            t["user_id"] = user_id
        if not t.get("title"):
            first = (t.get("messages") or [{}])[0].get("content", "")
            t["title"] = _default_title(first)
        t.setdefault("working_summary", "")
        t.setdefault("temporary_context", [])
        t.setdefault("clarification_events", [])
        if not isinstance(t.get("clarification_state"), dict):
            t["clarification_state"] = default_clarification_state()
        else:
            base = default_clarification_state()
            base.update(t["clarification_state"])
            t["clarification_state"] = base
        return t
    except Exception:
        return create_thread(user_id=user_id)


def save_thread(thread: dict[str, Any]) -> None:
    thread["updated_at"] = _now()
    uid = str(thread.get("user_id") or "demo_user")
    _thread_path(uid, thread["thread_id"]).write_text(json.dumps(thread, ensure_ascii=False, indent=2), encoding="utf-8")


def delete_thread(*, user_id: str, thread_id: str) -> bool:
    p = _thread_path(user_id, thread_id)
    if not p.exists():
        return False
    p.unlink(missing_ok=True)
    return True


def append_clarification_event(
    thread: dict[str, Any],
    *,
    kind: str,
    target_dimension: str,
    question_prompt: str = "",
    answer_label: str = "",
    persistence: str = "",
) -> None:
    """Record clarification ask / answer / skip for repetition-aware gating."""
    thread.setdefault("clarification_events", []).append(
        {
            "at": _now(),
            "kind": kind,
            "target_dimension": (target_dimension or "").strip(),
            "question_prompt": (question_prompt or "")[:900],
            "answer_label": (answer_label or "")[:900],
            "persistence": (persistence or "").strip(),
        }
    )
    st = thread.setdefault("clarification_state", default_clarification_state())
    td = (target_dimension or "").strip()
    if kind == "answered" and td:
        ad = st.setdefault("answered_dimensions", [])
        if td not in ad:
            ad.append(td)
    if kind == "skipped" and td:
        sd = st.setdefault("skipped_dimensions", [])
        if td not in sd:
            sd.append(td)
    if kind == "asked" and (question_prompt or "").strip():
        st["last_question"] = (question_prompt or "")[:900]
        st["last_target_dimension"] = td
        st["last_asked_at"] = _now()
    save_thread(thread)


def append_message(
    thread: dict[str, Any],
    *,
    role: str,
    content: str,
    mode: str,
    intent: str | None = None,
    status: str = "complete",
    suggestion_type: str | None = None,
    decision_id: str | None = None,
    memory_used: bool = False,
    profile_updated: bool = False,
    metadata_extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "mode": mode,
        "intent": intent,
        "memory_used": memory_used,
        "profile_updated": profile_updated,
        "suggestion_type": suggestion_type,
        "decision_id": decision_id,
    }
    if metadata_extra:
        meta.update(metadata_extra)
    msg = {
        "id": str(uuid.uuid4()),
        "role": role,
        "content": content,
        "created_at": _now(),
        "status": status,
        "metadata": meta,
    }
    thread.setdefault("messages", []).append(msg)
    if thread.get("title", "New chat") == "New chat" and role == "user":
        thread["title"] = _default_title(content)
    if decision_id:
        ids = thread.setdefault("linked_decision_ids", [])
        if decision_id not in ids:
            ids.append(decision_id)
    save_thread(thread)
    return msg

