"""Settings: Supabase URL implies JWT-only API tenancy by default."""

from foresight_x.config import Settings


def test_supabase_url_forces_require_auth() -> None:
    s = Settings(
        supabase_url="https://example.supabase.co",
        require_auth=False,
        allow_persona_fallback_with_supabase=False,
    )
    assert s.require_auth is True


def test_persona_fallback_opt_out_keeps_require_auth_false() -> None:
    s = Settings(
        supabase_url="https://example.supabase.co",
        require_auth=False,
        allow_persona_fallback_with_supabase=True,
    )
    assert s.require_auth is False


def test_no_supabase_does_not_force_require_auth() -> None:
    s = Settings(supabase_url="", require_auth=False)
    assert s.require_auth is False
