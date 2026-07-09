"""F0 memory precision cases — $0."""

from __future__ import annotations

import pytest

from tests.quality.loaders import load_memory_cases
from tests.quality.metrics import score_memory_precision


@pytest.mark.parametrize("case", load_memory_cases(), ids=lambda c: c.id)
def test_memory_precision(case) -> None:
    result = score_memory_precision(case)
    assert result["pass"], result
