"""User-facing degradation banner policy (FOR-20 / decision report UX)."""

from __future__ import annotations

from foresight_x.orchestration.degradation_policy import should_surface_degradation_to_user


def test_runtime_validation_error_not_surfaced() -> None:
    row = {
        "stage": "runtime",
        "error_kind": "ValidationError",
        "reason": "openai error: ValidationError",
    }
    assert should_surface_degradation_to_user(row) is False


def test_llm_gateway_failover_not_surfaced() -> None:
    row = {
        "stage": "llm_gateway",
        "error_kind": "ValidationError",
        "reason": "provider failed; failing over (primary_error)",
    }
    assert should_surface_degradation_to_user(row) is False


def test_stage_llm_unavailable_fallback_not_surfaced() -> None:
    row = {
        "stage": "infer",
        "error_kind": "llm_unavailable",
        "reason": "LLM unavailable; template options",
    }
    assert should_surface_degradation_to_user(row) is False


def test_circuit_open_is_surfaced() -> None:
    row = {
        "stage": "infra_probe",
        "error_kind": "circuit_open",
        "reason": "circuit breaker open",
    }
    assert should_surface_degradation_to_user(row) is True


def test_outage_is_surfaced() -> None:
    row = {
        "stage": "runtime",
        "error_kind": "outage",
        "reason": "chaos injection outage",
    }
    assert should_surface_degradation_to_user(row) is True
