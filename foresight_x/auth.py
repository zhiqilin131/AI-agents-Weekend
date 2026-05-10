"""Authentication helpers for Supabase-issued JWTs (ES256/JWKS)."""

from __future__ import annotations

import json
import time
from contextvars import ContextVar, Token
from threading import Lock
from typing import Annotated, Any

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError

from foresight_x.config import load_settings

_JWKS_TTL_SECONDS = 3600
_jwks_cache: dict[str, Any] | None = None
_jwks_cached_at: float = 0.0
_jwks_lock = Lock()

bearer_optional = HTTPBearer(auto_error=False)

# Populated per request by API middleware when a Bearer token is present and valid.
_supabase_user_ctx: ContextVar[dict[str, str | None] | None] = ContextVar("_supabase_user_ctx", default=None)


def get_supabase_user_for_request() -> dict[str, str | None] | None:
    """JWT-derived user dict for the current request (``id``, ``email``, ``jwt``), if middleware validated a token."""
    return _supabase_user_ctx.get()


def supabase_user_ctx_reset(token: Token[dict[str, str | None] | None]) -> None:
    _supabase_user_ctx.reset(token)


def supabase_user_ctx_set(user: dict[str, str | None] | None) -> Token[dict[str, str | None] | None]:
    return _supabase_user_ctx.set(user)


def _jwks_url(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/auth/v1/.well-known/jwks.json"


def _get_jwks(supabase_url: str, *, force_refresh: bool = False) -> dict[str, Any]:
    global _jwks_cache, _jwks_cached_at
    now = time.time()
    with _jwks_lock:
        if (
            not force_refresh
            and _jwks_cache is not None
            and (now - _jwks_cached_at) < _JWKS_TTL_SECONDS
        ):
            return _jwks_cache
        try:
            resp = httpx.get(_jwks_url(supabase_url), timeout=8.0)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Failed to fetch JWKS: {exc}",
            ) from exc
        if not isinstance(data, dict) or not isinstance(data.get("keys"), list):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Invalid JWKS payload from Supabase",
            )
        _jwks_cache = data
        _jwks_cached_at = now
        return data


def _signing_key_from_jwks(token: str, jwks: dict[str, Any]):
    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token header: {exc}") from exc
    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="JWT missing kid")
    key_jwk = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if key_jwk is None:
        return None
    return jwt.algorithms.ECAlgorithm.from_jwk(json.dumps(key_jwk))


def decode_supabase_access_token(token: str) -> dict[str, str | None]:
    """Validate Supabase access JWT and return ``id``, ``email``, ``jwt``."""
    settings = load_settings()
    if not settings.supabase_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SUPABASE_URL is not configured",
        )
    issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1"
    jwks = _get_jwks(settings.supabase_url)
    signing_key = _signing_key_from_jwks(token, jwks)
    if signing_key is None:
        jwks = _get_jwks(settings.supabase_url, force_refresh=True)
        signing_key = _signing_key_from_jwks(token, jwks)
    if signing_key is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No matching JWKS key for token kid")
    try:
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["ES256"],
            audience="authenticated",
            issuer=issuer,
        )
    except InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {exc}") from exc
    sub = str(payload.get("sub") or "").strip()
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing sub")
    return {
        "id": sub,
        "email": str(payload.get("email") or "") if payload.get("email") is not None else None,
        "jwt": token,
    }


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_optional)],
) -> dict[str, str | None]:
    """Decode Supabase JWT and return user identity."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    return decode_supabase_access_token(credentials.credentials)


def get_current_user_optional(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_optional)],
) -> dict[str, str | None] | None:
    if credentials is None or not credentials.credentials:
        return None
    return decode_supabase_access_token(credentials.credentials)
