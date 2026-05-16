"""Chaos fault injection for resilience demos and tests (armed only when ``FX_CHAOS=1``)."""

from __future__ import annotations

import json
import os
import random
import threading
import time
from dataclasses import dataclass, field
from typing import Any

# Canonical targets (FOR-22)
TARGET_LLM_PRIMARY = "llm.primary"
TARGET_LLM_FALLBACK = "llm.fallback"
TARGET_TAVILY = "tavily"
TARGET_MCP_LINEAR = "mcp.linear"

_ALL_TARGETS = (TARGET_LLM_PRIMARY, TARGET_LLM_FALLBACK, TARGET_TAVILY, TARGET_MCP_LINEAR)

# Env keys per target (JSON profile or shorthand mode string)
_ENV_BY_TARGET: dict[str, str] = {
    TARGET_LLM_PRIMARY: "FX_CHAOS_LLM_PRIMARY",
    TARGET_LLM_FALLBACK: "FX_CHAOS_LLM_FALLBACK",
    TARGET_TAVILY: "FX_CHAOS_TAVILY",
    TARGET_MCP_LINEAR: "FX_CHAOS_MCP_LINEAR",
}

# Legacy CHAOS_*_MODE aliases
_LEGACY_ENV: dict[str, str] = {
    "openai": "CHAOS_OPENAI_MODE",
    "tavily": "CHAOS_TAVILY_MODE",
    "linear_mcp": "CHAOS_LINEAR_MCP_MODE",
}

_LEGACY_TARGET: dict[str, str] = {
    "openai": TARGET_LLM_PRIMARY,
    "tavily": TARGET_TAVILY,
    "linear_mcp": TARGET_MCP_LINEAR,
}


from foresight_x.resilience.errors import DependencyDegraded  # noqa: F401 — re-export

@dataclass
class ChaosProfile:
    """Fault profile for one dependency target."""

    error_rate: float = 0.0
    latency_ms: int = 0
    latency_jitter_ms: int = 0
    status: int | None = None
    partial_json: bool = False
    outage: bool = False

    def normalized(self) -> ChaosProfile:
        rate = min(1.0, max(0.0, float(self.error_rate)))
        lat = max(0, int(self.latency_ms))
        jitter = max(0, int(self.latency_jitter_ms))
        st = int(self.status) if self.status is not None else None
        return ChaosProfile(
            error_rate=rate,
            latency_ms=lat,
            latency_jitter_ms=jitter,
            status=st,
            partial_json=bool(self.partial_json),
            outage=bool(self.outage),
        )

    def is_active(self) -> bool:
        p = self.normalized()
        return (
            p.outage
            or p.partial_json
            or p.status is not None
            or p.error_rate > 0
            or p.latency_ms > 0
        )

    def legacy_mode(self) -> str:
        """Short mode string for trace snapshots and backward compatibility."""
        p = self.normalized()
        if p.outage:
            return "outage"
        if p.status == 429:
            return "429"
        if p.status in (408,):
            return "timeout"
        if p.status is not None and p.status >= 500:
            return "5xx"
        if p.partial_json:
            return "partial_json"
        if p.error_rate > 0:
            return f"error_rate={p.error_rate}"
        if p.latency_ms > 0:
            return f"latency_ms={p.latency_ms}"
        return "active"


_REGISTRY_LOCK = threading.Lock()
_RUNTIME_PROFILES: dict[str, ChaosProfile] = {}
_PARTIAL_JSON_ONCE: dict[str, bool] = {}
_RNG = random.Random()


def chaos_armed() -> bool:
    return os.getenv("FX_CHAOS", "").strip().lower() in ("1", "true", "yes", "on")


def normalize_target(target: str) -> str:
    t = (target or "").strip().lower().replace("_", ".")
    aliases = {
        "openai": TARGET_LLM_PRIMARY,
        "llm.primary": TARGET_LLM_PRIMARY,
        "llmprimary": TARGET_LLM_PRIMARY,
        "llm.fallback": TARGET_LLM_FALLBACK,
        "llmfallback": TARGET_LLM_FALLBACK,
        "mcp.linear": TARGET_MCP_LINEAR,
        "linear": TARGET_MCP_LINEAR,
        "linear.mcp": TARGET_MCP_LINEAR,
        "linearmcp": TARGET_MCP_LINEAR,
    }
    if t in aliases:
        return aliases[t]
    if t in _ALL_TARGETS:
        return t
    if t == "tavily":
        return TARGET_TAVILY
    return (target or "").strip()


def parse_profile(raw: str | dict[str, Any] | None) -> ChaosProfile | None:
    if raw is None:
        return None
    if isinstance(raw, dict):
        return ChaosProfile(
            error_rate=float(raw.get("error_rate", 0) or 0),
            latency_ms=int(raw.get("latency_ms", 0) or 0),
            latency_jitter_ms=int(raw.get("latency_jitter_ms", 0) or 0),
            status=(int(raw["status"]) if raw.get("status") is not None else None),
            partial_json=bool(raw.get("partial_json", False)),
            outage=bool(raw.get("outage", False)),
        ).normalized()
    text = str(raw).strip()
    if not text:
        return None
    if text.startswith("{"):
        try:
            return parse_profile(json.loads(text))
        except Exception:
            return None
    low = text.lower()
    if low in ("outage", "down", "off"):
        return ChaosProfile(outage=True).normalized()
    if low in ("5xx", "500", "503", "502"):
        return ChaosProfile(status=500, outage=True).normalized()
    if low in ("429", "rate_limit", "ratelimit"):
        return ChaosProfile(status=429).normalized()
    if low in ("408", "timeout"):
        return ChaosProfile(status=408).normalized()
    if low in ("partial_json", "partial", "truncated"):
        return ChaosProfile(partial_json=True).normalized()
    if low.startswith("error_rate="):
        try:
            rate = float(low.split("=", 1)[1])
            return ChaosProfile(error_rate=rate).normalized()
        except Exception:
            return None
    if low.startswith("latency_ms="):
        try:
            ms = int(low.split("=", 1)[1])
            return ChaosProfile(latency_ms=ms).normalized()
        except Exception:
            return None
    return ChaosProfile(outage=True).normalized()


def set_runtime_profile(target: str, profile: ChaosProfile | None) -> None:
    if not chaos_armed():
        return
    key = normalize_target(target)
    with _REGISTRY_LOCK:
        if profile is None or not profile.is_active():
            _RUNTIME_PROFILES.pop(key, None)
        else:
            _RUNTIME_PROFILES[key] = profile.normalized()


def clear_runtime_profiles() -> None:
    with _REGISTRY_LOCK:
        _RUNTIME_PROFILES.clear()
        _PARTIAL_JSON_ONCE.clear()


def get_profile(target: str) -> ChaosProfile | None:
    if not chaos_armed():
        return None
    key = normalize_target(target)
    with _REGISTRY_LOCK:
        reg = _RUNTIME_PROFILES.get(key)
    if reg is not None and reg.is_active():
        return reg.normalized()
    env_key = _ENV_BY_TARGET.get(key)
    if env_key:
        raw = os.getenv(env_key, "").strip()
        if raw:
            prof = parse_profile(raw)
            if prof and prof.is_active():
                return prof
    # Legacy env
    for legacy_name, legacy_target in _LEGACY_TARGET.items():
        if legacy_target != key:
            continue
        leg_key = _LEGACY_ENV.get(legacy_name, "")
        if not leg_key:
            continue
        raw = os.getenv(leg_key, "").strip()
        if raw:
            prof = parse_profile(raw)
            if prof and prof.is_active():
                return prof
    return None


def chaos_mode(provider: str) -> str:
    """Backward-compatible mode string for ``CHAOS_OPENAI_MODE``-style callers."""
    legacy = (provider or "").strip().lower()
    target = _LEGACY_TARGET.get(legacy, normalize_target(legacy))
    prof = get_profile(target)
    if prof is None:
        return ""
    return prof.legacy_mode()


def chaos_profile_snapshot() -> dict[str, str]:
    return {
        "openai": chaos_mode("openai"),
        "tavily": chaos_mode("tavily"),
        "linear_mcp": chaos_mode("linear_mcp"),
        "llm.primary": chaos_mode(TARGET_LLM_PRIMARY),
        "llm.fallback": chaos_mode(TARGET_LLM_FALLBACK),
        "mcp.linear": chaos_mode(TARGET_MCP_LINEAR),
    }


def list_active_profiles() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for t in _ALL_TARGETS:
        p = get_profile(t)
        if p and p.is_active():
            out[t] = profile_to_dict(p)
    return out


def profile_to_dict(profile: ChaosProfile) -> dict[str, Any]:
    p = profile.normalized()
    return {
        "error_rate": p.error_rate,
        "latency_ms": p.latency_ms,
        "latency_jitter_ms": p.latency_jitter_ms,
        "status": p.status,
        "partial_json": p.partial_json,
        "outage": p.outage,
        "legacy_mode": p.legacy_mode(),
    }


def profile_from_dict(data: dict[str, Any]) -> ChaosProfile:
    return parse_profile(data) or ChaosProfile()


def _apply_latency(profile: ChaosProfile) -> None:
    p = profile.normalized()
    if p.latency_ms <= 0:
        return
    jitter = p.latency_jitter_ms
    extra = _RNG.uniform(0, float(jitter)) if jitter > 0 else 0.0
    time.sleep((p.latency_ms + extra) / 1000.0)


def _should_fail(profile: ChaosProfile) -> bool:
    p = profile.normalized()
    if p.outage:
        return True
    if p.status is not None:
        return True
    if p.error_rate > 0 and _RNG.random() < p.error_rate:
        return True
    return False


def build_degraded_exception(target: str, profile: ChaosProfile) -> DependencyDegraded:
    p = profile.normalized()
    status = int(p.status) if p.status is not None else (503 if p.outage else 500)
    reason = "chaos_outage" if p.outage else f"chaos_status_{status}"
    if p.partial_json:
        reason = "chaos_partial_json"
    elif p.error_rate > 0:
        reason = f"chaos_error_rate_{p.error_rate}"
    return DependencyDegraded(target, status=status, reason=reason, retryable=True)


def maybe_raise(target: str, *, rng: random.Random | None = None) -> None:
    """Apply chaos for *target*; raise :class:`DependencyDegraded` when configured to fail."""
    global _RNG
    if rng is not None:
        _RNG = rng
    if not chaos_armed():
        return
    key = normalize_target(target)
    profile = get_profile(key)
    if profile is None or not profile.is_active():
        return
    _apply_latency(profile)
    if _should_fail(profile):
        raise build_degraded_exception(key, profile)


def consume_partial_json_slot(target: str, profile: ChaosProfile) -> bool:
    """Return True once per target when ``partial_json`` should fire on this call."""
    if not profile.normalized().partial_json:
        return False
    key = normalize_target(target)
    with _REGISTRY_LOCK:
        if _PARTIAL_JSON_ONCE.get(key):
            return False
        _PARTIAL_JSON_ONCE[key] = True
    return True


def reset_partial_json_slots() -> None:
    with _REGISTRY_LOCK:
        _PARTIAL_JSON_ONCE.clear()


def apply_env_leg(profile_map: dict[str, str | dict[str, Any] | ChaosProfile | None]) -> None:
    """Set runtime profiles from a leg config (chaos demo driver). Requires ``FX_CHAOS=1``."""
    clear_runtime_profiles()
    reset_partial_json_slots()
    if not chaos_armed():
        return
    for target, raw in profile_map.items():
        if raw is None:
            continue
        if isinstance(raw, ChaosProfile):
            prof = raw
        elif isinstance(raw, dict):
            prof = profile_from_dict(raw)
        else:
            prof = parse_profile(str(raw))
        if prof and prof.is_active():
            set_runtime_profile(target, prof)
