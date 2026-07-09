"""Pytest hooks for tests/quality — quieter local runs."""

from __future__ import annotations

import pytest

from tests.quality.quiet import configure_quiet_benchmark


def pytest_configure(config: pytest.Config) -> None:
    configure_quiet_benchmark()
    config.addinivalue_line(
        "filterwarnings",
        "ignore:The 'validate_default' attribute.*:UserWarning",
    )
    try:
        from pydantic.warnings import UnsupportedFieldAttributeWarning

        config.addinivalue_line(
            "filterwarnings",
            f"ignore::{UnsupportedFieldAttributeWarning.__module__}.{UnsupportedFieldAttributeWarning.__name__}",
        )
    except ImportError:
        pass
