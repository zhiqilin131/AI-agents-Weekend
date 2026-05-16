from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from foresight_x.config import load_settings
from foresight_x.db.supabase_client import get_client
from foresight_x.chat.thread_title import heuristic_thread_title
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.perception.clarification_gate import default_clarification_state
from foresight_x.structured_predict import structured_predict

_log = logging.getLogger(__name__)

_IS_PRODUCTION = (
    os.environ.get("VERCEL") == "1"
    or os.environ.get("FORESIGHT_ENV") == "production"
)


class ThreadNotFoundError(KeyError):
    """No saved thread for this ``user_id`` + ``thread_id`` (and caller forbids auto-create)."""


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _is_valid_uuid(v: str | None) -> bool:
    if not v:
        return False
    try:
        uuid.UUID(str(v))
        return True
    except Exception:
        return False


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
    return heuristic_thread_title(first_message)


_PLACEHOLDER_TITLES = {
    "",
    "new chat",
    "untitled",
    "conversation",
    "chat",
    "shadow chat",
}

_LIGHT_GREETINGS = {
    "hi",
    "hello",
    "hey",
    "yo",
    "sup",
    "thanks",
    "thank you",
    "ok",
    "okay",
    "cool",
}

_COMMON_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "between",
    "be",
    "but",
    "by",
    "for",
    "from",
    "how",
    "i",
    "if",
    "in",
    "into",
    "is",
    "im",
    "i'm",
    "it",
    "its",
    "me",
    "my",
    "of",
    "on",
    "or",
    "our",
    "so",
    "that",
    "the",
    "their",
    "them",
    "this",
    "to",
    "us",
    "we",
    "what",
    "when",
    "while",
    "with",
    "you",
    "your",
}


class ThreadTitleLLM(BaseModel):
    title: str = Field(
        default="",
        description="A concise chat title capturing the user's core intent, ideally 3-8 words.",
        max_length=64,
    )


_TITLE_PROMPT = """Generate a concise title for this chat.

Goal:
- Capture the user's intent in plain language.
- Title should be intuitive and skimmable.

Rules:
- 3 to 8 words.
- Prefer noun/verb phrases (not a full sentence).
- Use the same language as the user.
- Avoid generic titles like "Conversation", "New chat", "Question".
- No surrounding quotes.

Recent messages:
---
{recent}
---

Return JSON with only: title
"""

_AUTOTITLE_LLM_ATTEMPTED_THREAD_IDS: set[str] = set()
_TITLE_SOURCE_AUTO = "auto"
_TITLE_SOURCE_MANUAL = "manual"


def _is_placeholder_title(title: str | None) -> bool:
    t = " ".join(str(title or "").strip().lower().split())
    return t in _PLACEHOLDER_TITLES


def _is_cjk_text(text: str) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", text or ""))


def _sanitize_summary_source(text: str) -> str:
    raw = " ".join(str(text or "").strip().split())
    if not raw:
        return ""
    return raw.strip(" .,:;!?-_=+*#`~()[]{}<>\"'")


def _is_meaningful_user_text(text: str) -> bool:
    s = _sanitize_summary_source(text).lower()
    if not s:
        return False
    if s in _LIGHT_GREETINGS:
        return False
    if _is_cjk_text(s):
        return len(s) >= 6
    words = [w for w in s.split() if w]
    if len(words) <= 2 and len(s) < 16:
        return False
    return True


def _summarize_user_text(text: str) -> str:
    s = _sanitize_summary_source(text)
    if not s:
        return ""

    if _is_cjk_text(s):
        compact = "".join(s.split())
        return compact[:18] + ("..." if len(compact) > 18 else "")

    def _compact_phrase_for_title(phrase: str, *, max_words: int = 5) -> str:
        clean = re.sub(r"\s+", " ", phrase.strip())
        clean = clean.strip(" .,:;!?-_=+*#`~()[]{}<>\"'")
        if not clean:
            return ""
        words = [w.strip(".,:;!?()[]{}\"'").lower() for w in clean.split()]
        words = [w for w in words if w]
        words = [w for w in words if w not in _COMMON_STOPWORDS]
        if not words:
            return ""
        return " ".join(words[:max_words])

    # Strong pattern for common decision framing:
    # "I'm torn between X and/or Y" -> "X vs Y"
    m = re.search(
        r"\bbetween\s+(.+?)\s+(?:and|or|vs|versus)\s+(.+?)(?:[.!?\n]|$)",
        s,
        flags=re.IGNORECASE,
    )
    if m:
        left = _compact_phrase_for_title(m.group(1), max_words=5)
        right = _compact_phrase_for_title(m.group(2), max_words=5)
        if left and right:
            pair = f"{left} vs {right}"
            return pair[:64] + ("..." if len(pair) > 64 else "")

    sentence = re.split(r"[.!?\n]", s, maxsplit=1)[0].strip() or s
    tokens = [w.strip(".,:;!?()[]{}\"'").lower() for w in sentence.split()]
    tokens = [w for w in tokens if w]
    content_words = [w for w in tokens if w not in _COMMON_STOPWORDS]
    picked = content_words[:6] if len(content_words) >= 3 else tokens[:8]
    if not picked:
        return ""

    out = " ".join(picked)
    return out[:64] + ("..." if len(out) > 64 else "")


def _format_autotitle_recent_messages(messages: list[dict[str, Any]]) -> str:
    rows: list[str] = []
    picked = messages[-8:] if len(messages) > 8 else messages
    for row in picked:
        if not isinstance(row, dict):
            continue
        role = str(row.get("role") or "").strip().lower() or "unknown"
        content = " ".join(str(row.get("content") or "").strip().split())
        if not content:
            continue
        if len(content) > 280:
            content = content[:280] + "..."
        rows.append(f"{role}: {content}")
    return "\n".join(rows)


def _normalize_generated_title(title: str) -> str:
    t = " ".join(str(title or "").strip().split())
    t = t.strip("\"'`")
    if not t:
        return ""
    if _is_placeholder_title(t):
        return ""
    words = t.split()
    if len(words) > 8:
        t = " ".join(words[:8]).strip()
    return t[:64] + ("..." if len(t) > 64 else "")


def _llm_summarize_thread_title(thread: dict[str, Any], *, force: bool = False) -> str:
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return ""

    thread_id = str(thread.get("thread_id") or "")
    if (not force) and thread_id and thread_id in _AUTOTITLE_LLM_ATTEMPTED_THREAD_IDS:
        return ""
    if thread_id:
        _AUTOTITLE_LLM_ATTEMPTED_THREAD_IDS.add(thread_id)

    settings = load_settings()
    if not (settings.openai_api_key or "").strip():
        return ""

    messages = thread.get("messages") or []
    if not isinstance(messages, list):
        return ""
    recent = _format_autotitle_recent_messages(messages)
    if not recent:
        return ""

    prompt = _TITLE_PROMPT.format(recent=recent)
    try:
        llm = build_openai_llm(settings=settings, temperature=0.1)
        out = structured_predict(llm, ThreadTitleLLM, prompt)
    except Exception:
        _log.debug("llm autotitle generation failed", exc_info=True)
        return ""

    title = _normalize_generated_title(getattr(out, "title", ""))
    return title


def _maybe_autotitle_from_messages(thread: dict[str, Any]) -> bool:
    if not _is_placeholder_title(thread.get("title")):
        return False
    title = _compute_best_title_from_messages(thread, require_assistant=True)
    if not title:
        return False
    thread["title"] = title
    thread["title_source"] = _TITLE_SOURCE_AUTO
    return True


def _ensure_thread_title_source(thread: dict[str, Any]) -> None:
    src = str(thread.get("title_source") or "").strip().lower()
    if src in {_TITLE_SOURCE_AUTO, _TITLE_SOURCE_MANUAL}:
        return
    if _is_placeholder_title(thread.get("title")):
        thread["title_source"] = _TITLE_SOURCE_AUTO
    else:
        thread["title_source"] = _TITLE_SOURCE_MANUAL


def _compute_best_title_from_messages(
    thread: dict[str, Any],
    *,
    force_llm: bool = False,
    require_assistant: bool = False,
) -> str:
    messages = thread.get("messages") or []
    if not isinstance(messages, list):
        return ""
    if require_assistant:
        has_assistant = any(
            isinstance(row, dict) and str(row.get("role") or "") == "assistant"
            for row in messages
        )
        if not has_assistant:
            return ""
    meaningful_user_rows: list[dict[str, Any]] = []
    for row in messages:
        if not isinstance(row, dict):
            continue
        if str(row.get("role") or "") != "user":
            continue
        content = str(row.get("content") or "")
        if _is_meaningful_user_text(content):
            meaningful_user_rows.append(row)
    if not meaningful_user_rows:
        return ""

    llm_title = _llm_summarize_thread_title(thread, force=force_llm)
    if llm_title:
        return llm_title

    for row in meaningful_user_rows:
        content = str(row.get("content") or "")
        title = _summarize_user_text(content)
        if title:
            return title
    return ""


def regenerate_thread_title(thread: dict[str, Any]) -> str:
    """Recompute title from conversation; explicit user-triggered auto title refresh."""
    title = _compute_best_title_from_messages(thread, force_llm=True, require_assistant=False)
    if not title:
        return str(thread.get("title") or "")
    thread["title"] = title
    thread["title_source"] = _TITLE_SOURCE_AUTO
    return title


def set_manual_thread_title(thread: dict[str, Any], title: str) -> str:
    clean = " ".join(str(title or "").strip().split())
    if not clean:
        clean = "New chat"
    thread["title"] = clean[:200]
    thread["title_source"] = _TITLE_SOURCE_MANUAL
    return thread["title"]


def _default_thread_payload(*, user_id: str, thread_id: str, title: str | None = None) -> dict[str, Any]:
    provided_title = " ".join(str(title or "").strip().split())
    return {
        "thread_id": thread_id,
        "user_id": user_id,
        "title": provided_title or "New chat",
        "title_source": (_TITLE_SOURCE_MANUAL if provided_title else _TITLE_SOURCE_AUTO),
        "created_at": _now(),
        "updated_at": _now(),
        "mode": "shadow",
        "messages": [],
        "memory_events": [],
        "dismissed_suggestions": {"role_mode": False, "decision_report": False},
        "linked_decision_ids": [],
        "working_summary": "",
        "temporary_context": [],
        "clarification_events": [],
        "clarification_state": default_clarification_state(),
        "decision_trigger_state": {},
    }


def _local_create_thread(*, user_id: str, title: str | None = None) -> dict[str, Any]:
    tid = str(uuid.uuid4())
    t = _default_thread_payload(user_id=user_id, thread_id=tid, title=title)
    _local_save_thread(t)
    return t


def _local_list_threads(*, user_id: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    d = _user_thread_dir(user_id)
    for p in sorted(d.glob("*.json"), reverse=True):
        try:
            t = json.loads(p.read_text(encoding="utf-8"))
            _ensure_thread_title_source(t)
            out.append(
                {
                    "thread_id": t.get("thread_id"),
                    "title": t.get("title") or "New chat",
                    "title_source": t.get("title_source", _TITLE_SOURCE_AUTO),
                    "updated_at": t.get("updated_at"),
                    "created_at": t.get("created_at"),
                    "mode": t.get("mode", "shadow"),
                    "message_count": len(t.get("messages", [])),
                }
            )
        except Exception:
            continue
    return sorted(out, key=lambda x: str(x.get("updated_at") or ""), reverse=True)


def _local_load_thread(thread_id: str | None, *, user_id: str, allow_create: bool = True) -> dict[str, Any]:
    if not thread_id:
        if not allow_create:
            raise ThreadNotFoundError("missing thread_id")
        return _local_create_thread(user_id=user_id)
    p = _thread_path(user_id, thread_id)
    if not p.is_file():
        if not allow_create:
            raise ThreadNotFoundError(thread_id)
        return _local_create_thread(user_id=user_id)
    try:
        t = json.loads(p.read_text(encoding="utf-8"))
        if not t.get("user_id"):
            t["user_id"] = user_id
        _ensure_thread_title_source(t)
        if _is_placeholder_title(t.get("title")):
            _maybe_autotitle_from_messages(t)
        if not t.get("title"):
            first = (t.get("messages") or [{}])[0].get("content", "")
            t["title"] = _default_title(first)
        t.setdefault("working_summary", "")
        t.setdefault("temporary_context", [])
        t.setdefault("clarification_events", [])
        t.setdefault("decision_trigger_state", {})
        if not isinstance(t.get("clarification_state"), dict):
            t["clarification_state"] = default_clarification_state()
        else:
            base = default_clarification_state()
            base.update(t["clarification_state"])
            t["clarification_state"] = base
        return t
    except Exception:
        return _local_create_thread(user_id=user_id)


def _local_save_thread(thread: dict[str, Any]) -> None:
    thread["updated_at"] = _now()
    uid = str(thread.get("user_id") or "demo_user")
    _thread_path(uid, thread["thread_id"]).write_text(json.dumps(thread, ensure_ascii=False, indent=2), encoding="utf-8")


def _local_delete_thread(*, user_id: str, thread_id: str) -> bool:
    p = _thread_path(user_id, thread_id)
    if not p.exists():
        return False
    p.unlink(missing_ok=True)
    return True


def _supabase_enabled() -> bool:
    s = load_settings()
    return (
        bool((s.supabase_url or "").strip())
        and bool((s.supabase_service_role_key or "").strip())
    )


def _warn_fallback(op: str, *, user_id: str, exc: Exception | None = None) -> None:
    if exc is None:
        _log.warning("thread_store fallback to local JSON: op=%s user_id=%s", op, user_id)
        return
    _log.warning(
        "thread_store fallback to local JSON: op=%s user_id=%s err=%s",
        op,
        user_id,
        exc,
    )


def _handle_supabase_failure(op: str, user_id: str, exc: Exception):
    if _IS_PRODUCTION:
        _log.error(
            "supabase %s failed in production, refusing fallback: user_id=%s err=%s",
            op,
            user_id,
            exc,
        )
        raise exc
    _warn_fallback(op, user_id=user_id, exc=exc)


def _thread_metadata_from_thread(thread: dict[str, Any]) -> dict[str, Any]:
    return {
        "title_source": thread.get("title_source", _TITLE_SOURCE_AUTO),
        "memory_events": thread.get("memory_events", []),
        "dismissed_suggestions": thread.get("dismissed_suggestions", {"role_mode": False, "decision_report": False}),
        "linked_decision_ids": thread.get("linked_decision_ids", []),
        "working_summary": thread.get("working_summary", ""),
        "temporary_context": thread.get("temporary_context", []),
        "clarification_events": thread.get("clarification_events", []),
        "clarification_state": thread.get("clarification_state", default_clarification_state()),
        "decision_trigger_state": thread.get("decision_trigger_state", {}),
    }


def _hydrate_thread_from_row(
    *,
    user_id: str,
    row: dict[str, Any],
    messages: list[dict[str, Any]],
) -> dict[str, Any]:
    md = row.get("metadata")
    if not isinstance(md, dict):
        md = {}

    out = {
        "thread_id": str(row.get("id") or ""),
        "user_id": user_id,
        "title": row.get("title") or "New chat",
        "title_source": md.get("title_source", _TITLE_SOURCE_AUTO),
        "created_at": row.get("created_at") or _now(),
        "updated_at": row.get("updated_at") or row.get("created_at") or _now(),
        "mode": row.get("mode", "shadow"),
        "messages": messages,
        "memory_events": md.get("memory_events", []),
        "dismissed_suggestions": md.get("dismissed_suggestions", {"role_mode": False, "decision_report": False}),
        "linked_decision_ids": md.get("linked_decision_ids", []),
        "working_summary": md.get("working_summary", ""),
        "temporary_context": md.get("temporary_context", []),
        "clarification_events": md.get("clarification_events", []),
        "clarification_state": md.get("clarification_state", default_clarification_state()),
        "decision_trigger_state": md.get("decision_trigger_state", {}),
    }

    if not isinstance(out["clarification_state"], dict):
        out["clarification_state"] = default_clarification_state()
    else:
        base = default_clarification_state()
        base.update(out["clarification_state"])
        out["clarification_state"] = base
    if not isinstance(out.get("decision_trigger_state"), dict):
        out["decision_trigger_state"] = {}
    if _is_placeholder_title(out.get("title")):
        _maybe_autotitle_from_messages(out)
    _ensure_thread_title_source(out)
    return out


def _fetch_thread_row_supabase(*, user_id: str, thread_id: str) -> dict[str, Any] | None:
    client = get_client()
    resp = (
        client.table("threads")
        .select("id,user_id,title,mode,metadata,created_at,updated_at")
        .eq("id", thread_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = resp.data if isinstance(resp.data, list) else []
    if not rows:
        return None
    return rows[0]


def _fetch_messages_supabase(*, thread_id: str) -> list[dict[str, Any]]:
    client = get_client()
    resp = (
        client.table("messages")
        .select("id,thread_id,role,content,metadata,created_at")
        .eq("thread_id", thread_id)
        .order("created_at", desc=False)
        .execute()
    )
    rows = resp.data if isinstance(resp.data, list) else []
    out: list[dict[str, Any]] = []
    for r in rows:
        md = r.get("metadata")
        if not isinstance(md, dict):
            md = {}
        out.append(
            {
                "id": str(r.get("id") or ""),
                "role": str(r.get("role") or "assistant"),
                "content": str(r.get("content") or ""),
                "created_at": r.get("created_at") or _now(),
                "status": str(md.get("status") or "complete"),
                "metadata": md,
            }
        )
    return out


def _upsert_thread_supabase(thread: dict[str, Any]) -> None:
    client = get_client()
    tid = str(thread.get("thread_id") or "")
    uid = str(thread.get("user_id") or "demo_user")
    if not _is_valid_uuid(tid):
        tid = str(uuid.uuid4())
        thread["thread_id"] = tid
    payload = {
        "id": tid,
        "user_id": uid,
        "title": thread.get("title") or "New chat",
        "mode": thread.get("mode") or "shadow",
        "metadata": _thread_metadata_from_thread(thread),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    client.table("threads").upsert(payload, on_conflict="id").execute()


def _insert_new_messages_supabase(thread: dict[str, Any]) -> None:
    """
    Temporary compatibility strategy for legacy "save whole thread" callers:
    - We diff by message id and only insert missing rows into messages.
    - Existing rows are not updated here.
    """
    client = get_client()
    tid = str(thread.get("thread_id") or "")
    if not _is_valid_uuid(tid):
        return

    existing_resp = client.table("messages").select("id").eq("thread_id", tid).execute()
    existing_rows = existing_resp.data if isinstance(existing_resp.data, list) else []
    existing_ids = {str(r.get("id")) for r in existing_rows if r.get("id") is not None}

    incoming = thread.get("messages") or []
    if not isinstance(incoming, list):
        incoming = []

    to_insert: list[dict[str, Any]] = []
    for msg in incoming:
        if not isinstance(msg, dict):
            continue
        raw_id = str(msg.get("id") or "")
        msg_id = raw_id if _is_valid_uuid(raw_id) else str(uuid.uuid4())
        msg["id"] = msg_id

        if msg_id in existing_ids:
            continue

        md = msg.get("metadata")
        if not isinstance(md, dict):
            md = {}
        if "status" in msg and "status" not in md:
            md["status"] = msg.get("status")

        to_insert.append(
            {
                "id": msg_id,
                "thread_id": tid,
                "role": str(msg.get("role") or "assistant"),
                "content": str(msg.get("content") or ""),
                "metadata": md,
                "created_at": msg.get("created_at") or _now(),
            }
        )

    if to_insert:
        client.table("messages").insert(to_insert).execute()


def create_thread(*, user_id: str, title: str | None = None) -> dict[str, Any]:
    if _supabase_enabled():
        try:
            tid = str(uuid.uuid4())
            t = _default_thread_payload(user_id=user_id, thread_id=tid, title=title)
            _upsert_thread_supabase(t)
            return t
        except Exception as exc:
            _handle_supabase_failure("create_thread", user_id, exc)
    else:
        _warn_fallback("create_thread_supabase_not_fully_configured", user_id=user_id)

    return _local_create_thread(user_id=user_id, title=title)


def list_threads(*, user_id: str) -> list[dict[str, Any]]:
    if _supabase_enabled():
        try:
            client = get_client()
            resp = (
                client.table("threads")
                .select("id,title,mode,metadata,created_at,updated_at")
                .eq("user_id", user_id)
                .order("updated_at", desc=True)
                .execute()
            )
            rows = resp.data if isinstance(resp.data, list) else []

            out: list[dict[str, Any]] = []
            thread_ids = [str(r.get("id")) for r in rows if r.get("id") is not None]
            msg_count: dict[str, int] = {}

            if thread_ids:
                try:
                    mresp = (
                        client.table("messages")
                        .select("thread_id")
                        .in_("thread_id", thread_ids)
                        .execute()
                    )
                    mrows = mresp.data if isinstance(mresp.data, list) else []
                    for mr in mrows:
                        tid = str(mr.get("thread_id") or "")
                        if not tid:
                            continue
                        msg_count[tid] = msg_count.get(tid, 0) + 1
                except Exception:
                    pass

            for r in rows:
                tid = str(r.get("id") or "")
                out.append(
                    {
                        "thread_id": tid,
                        "title": r.get("title") or "New chat",
                        "title_source": (
                            (r.get("metadata") or {}).get("title_source", _TITLE_SOURCE_AUTO)
                            if isinstance(r.get("metadata"), dict)
                            else _TITLE_SOURCE_AUTO
                        ),
                        "updated_at": r.get("updated_at") or r.get("created_at"),
                        "created_at": r.get("created_at"),
                        "mode": r.get("mode", "shadow"),
                        "message_count": msg_count.get(tid, 0),
                    }
                )
            return out
        except Exception as exc:
            _handle_supabase_failure("list_threads", user_id, exc)
    else:
        _warn_fallback("list_threads_supabase_not_fully_configured", user_id=user_id)

    return _local_list_threads(user_id=user_id)


def load_thread(thread_id: str | None, *, user_id: str, allow_create: bool = True) -> dict[str, Any]:
    if not thread_id:
        if not allow_create:
            raise ThreadNotFoundError("missing thread_id")
        return create_thread(user_id=user_id)

    if _supabase_enabled():
        try:
            row = _fetch_thread_row_supabase(user_id=user_id, thread_id=thread_id)
            if row is None:
                if not allow_create:
                    raise ThreadNotFoundError(thread_id)
                return create_thread(user_id=user_id)

            msgs = _fetch_messages_supabase(thread_id=thread_id)
            return _hydrate_thread_from_row(user_id=user_id, row=row, messages=msgs)
        except ThreadNotFoundError:
            raise
        except Exception as exc:
            _handle_supabase_failure("load_thread", user_id, exc)
    else:
        _warn_fallback("load_thread_supabase_not_fully_configured", user_id=user_id)

    return _local_load_thread(thread_id, user_id=user_id, allow_create=allow_create)


def save_thread(thread: dict[str, Any]) -> None:
    uid = str(thread.get("user_id") or "demo_user")
    _ensure_thread_title_source(thread)

    if _supabase_enabled():
        try:
            tid = str(thread.get("thread_id") or "")
            if not _is_valid_uuid(tid):
                thread["thread_id"] = str(uuid.uuid4())

            # Important ordering:
            # 1) Insert new messages first
            # 2) Upsert thread metadata second
            # This avoids metadata-advanced / messages-missing partial state.
            _insert_new_messages_supabase(thread)
            _upsert_thread_supabase(thread)

            thread["updated_at"] = _now()
            return
        except Exception as exc:
            _handle_supabase_failure("save_thread", uid, exc)
    else:
        _warn_fallback("save_thread_supabase_not_fully_configured", user_id=uid)

    _local_save_thread(thread)


def delete_thread(*, user_id: str, thread_id: str) -> bool:
    if _supabase_enabled():
        try:
            if _fetch_thread_row_supabase(user_id=user_id, thread_id=thread_id) is None:
                return False
            client = get_client()
            client.table("messages").delete().eq("thread_id", thread_id).execute()
            resp = (
                client.table("threads")
                .delete()
                .eq("id", thread_id)
                .eq("user_id", user_id)
                .execute()
            )
            rows = resp.data if isinstance(resp.data, list) else []
            return len(rows) > 0
        except Exception as exc:
            _handle_supabase_failure("delete_thread", user_id, exc)
    else:
        _warn_fallback("delete_thread_supabase_not_fully_configured", user_id=user_id)

    return _local_delete_thread(user_id=user_id, thread_id=thread_id)


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
    title_llm: Any | None = None,
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
    if role == "assistant" and _is_placeholder_title(thread.get("title")):
        _maybe_autotitle_from_messages(thread)
    if decision_id:
        ids = thread.setdefault("linked_decision_ids", [])
        if decision_id not in ids:
            ids.append(decision_id)
    save_thread(thread)
    return msg
