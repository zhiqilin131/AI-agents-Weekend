"""Redis cache helpers."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

import redis.asyncio as redis

from foresight_x.config import load_settings

T = TypeVar("T")

_redis_client: redis.Redis | None = None


def get_redis_client() -> redis.Redis:
    """Lazily initialize a shared async Redis client."""
    global _redis_client
    if _redis_client is None:
        settings = load_settings()
        if not settings.redis_url:
            raise RuntimeError("REDIS_URL is not configured")
        _redis_client = redis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


def cache_key(prefix: str, payload: dict[str, Any]) -> str:
    blob = json.dumps(payload, sort_keys=True, default=str)
    digest = hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]
    return f"fx:{prefix}:{digest}"


async def cached_call(
    prefix: str,
    payload: dict[str, Any],
    fn: Callable[[], Awaitable[T]],
    ttl: int = 3600,
) -> T:
    """Read-through async cache helper."""
    key = cache_key(prefix, payload)
    client = get_redis_client()
    cached = await client.get(key)
    if cached is not None:
        return json.loads(cached)
    result = await fn()
    await client.set(key, json.dumps(result, default=str), ex=ttl)
    return result

