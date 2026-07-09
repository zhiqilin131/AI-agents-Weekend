"""Suppress benign noise during quality benchmark runs (local dev / CI)."""

from __future__ import annotations

import logging
import os
import warnings

_CONFIGURED = False

_QUIET_LOGGERS = (
    "foresight_x.profile.store",
    "foresight_x.chat.thread_store",
    "chromadb",
    "chromadb.telemetry",
    "posthog",
    "httpx",
    "httpcore",
    "openai",
    "llama_index",
    "urllib3",
    # Real graph backend (graphiti_core), active whenever GRAPH_ENABLED=true (e.g.
    # via .env, independent of this benchmark). Its edge-extraction step logs a
    # WARNING and skips the edge whenever the LLM names a source/target entity
    # that doesn't match that episode's node list (coreference mismatch) — this
    # never crashes the ingest, it just means one fewer edge got linked.
    "graphiti_core",
)

# chromadb 0.6.x calls posthog.capture(user_id, event_name, props) — 3 positional
# args. Installed posthog>=7 changed the signature to capture(event, **kwargs) —
# only 1 positional arg. Every telemetry submission now raises a TypeError that
# chromadb catches and logs via logger.error(...), regardless of
# ANONYMIZED_TELEMETRY (confirmed: still fires even when that's correctly False —
# it's a dependency version mismatch, not a config issue). It never affects
# reads/writes. Because this is logged at ERROR, setting the logger's level to
# ERROR (like _QUIET_LOGGERS above) does NOT suppress it — only a stricter
# CRITICAL threshold does, so it needs its own bucket.
_SILENCE_ENTIRELY = ("chromadb.telemetry.product.posthog",)


def benchmark_env() -> dict[str, str]:
    """Env overrides for subprocess benchmark runs."""
    return {
        "ANONYMIZED_TELEMETRY": "False",
        "FORESIGHT_QUALITY_QUIET": "1",
    }


def configure_quiet_benchmark() -> None:
    """Idempotent: disable telemetry + raise log thresholds for known-noisy loggers."""
    global _CONFIGURED
    if _CONFIGURED:
        return
    _CONFIGURED = True

    for key, value in benchmark_env().items():
        os.environ.setdefault(key, value)

    try:
        from pydantic.warnings import UnsupportedFieldAttributeWarning

        warnings.filterwarnings("ignore", category=UnsupportedFieldAttributeWarning)
    except ImportError:
        warnings.filterwarnings("ignore", message=".*validate_default.*")

    if os.environ.get("FORESIGHT_QUALITY_QUIET", "").strip() in ("1", "true", "yes"):
        for name in _QUIET_LOGGERS:
            logging.getLogger(name).setLevel(logging.ERROR)
        for name in _SILENCE_ENTIRELY:
            logging.getLogger(name).setLevel(logging.CRITICAL)
