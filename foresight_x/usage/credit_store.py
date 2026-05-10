"""File-backed persistence for balances, ledger lines, and redemptions."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path

from foresight_x.config import Settings, load_settings
from foresight_x.usage.schemas import CreditRedemption, CreditTransaction, UserCredits

_locks: dict[str, threading.Lock] = {}
_registry_lock = threading.Lock()


def _user_lock(user_id: str) -> threading.Lock:
    with _registry_lock:
        lk = _locks.get(user_id)
        if lk is None:
            lk = threading.Lock()
            _locks[user_id] = lk
        return lk


def usage_root(settings: Settings | None = None) -> Path:
    s = settings or load_settings()
    root = s.foresight_data_dir / "usage"
    root.mkdir(parents=True, exist_ok=True)
    return root


def credits_path(user_id: str, settings: Settings | None = None) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in user_id.strip())[:200]
    return usage_root(settings) / f"{safe}_credits.json"


def ledger_path(user_id: str, settings: Settings | None = None) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in user_id.strip())[:200]
    return usage_root(settings) / f"{safe}_ledger.jsonl"


def redemptions_path(user_id: str, settings: Settings | None = None) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in user_id.strip())[:200]
    return usage_root(settings) / f"{safe}_redemptions.json"


def _atomic_write_json(path: Path, obj: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".credits_", suffix=".json", dir=str(path.parent))
    try:
        data = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
        os.write(fd, data)
        os.close(fd)
        os.replace(tmp, path)
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def load_user_credits_row(user_id: str, settings: Settings | None = None) -> UserCredits | None:
    path = credits_path(user_id, settings)
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return UserCredits.model_validate(raw)
    except Exception:
        return None


def save_user_credits_row(row: UserCredits, settings: Settings | None = None) -> None:
    _atomic_write_json(credits_path(row.user_id, settings), row.model_dump(mode="json"))


def append_ledger(transaction: CreditTransaction, settings: Settings | None = None) -> None:
    path = ledger_path(transaction.user_id, settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(transaction.model_dump(mode="json"), ensure_ascii=False) + "\n"
    with path.open("a", encoding="utf-8") as f:
        f.write(line)


def load_recent_transactions(user_id: str, *, limit: int, settings: Settings | None = None) -> list[CreditTransaction]:
    path = ledger_path(user_id, settings)
    if not path.is_file():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    tail = lines[-max(limit * 3, limit) :]  # scan extra for filtering
    out: list[CreditTransaction] = []
    for ln in reversed(tail):
        if not ln.strip():
            continue
        try:
            out.append(CreditTransaction.model_validate_json(ln))
        except Exception:
            continue
        if len(out) >= limit:
            break
    out.reverse()
    return out


def find_usage_by_request_id(user_id: str, request_id: str, settings: Settings | None = None) -> CreditTransaction | None:
    if not (request_id or "").strip():
        return None
    path = ledger_path(user_id, settings)
    if not path.is_file():
        return None
    rid = request_id.strip()
    # Scan tail for performance
    lines = path.read_text(encoding="utf-8").splitlines()
    for ln in reversed(lines[-800:]):
        if not ln.strip():
            continue
        try:
            tx = CreditTransaction.model_validate_json(ln)
        except Exception:
            continue
        if tx.request_id == rid and tx.type == "usage":
            return tx
    return None


def load_redemptions(user_id: str, settings: Settings | None = None) -> list[CreditRedemption]:
    path = redemptions_path(user_id, settings)
    if not path.is_file():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("items"), list):
            raw_list = raw["items"]
        elif isinstance(raw, list):
            raw_list = raw
        else:
            return []
        return [CreditRedemption.model_validate(x) for x in raw_list]
    except Exception:
        return []


def save_redemptions(user_id: str, rows: list[CreditRedemption], settings: Settings | None = None) -> None:
    data = [r.model_dump(mode="json") for r in rows]
    _atomic_write_json(redemptions_path(user_id, settings), {"items": data})


def acquire_user_lock(user_id: str) -> threading.Lock:
    return _user_lock(user_id)
