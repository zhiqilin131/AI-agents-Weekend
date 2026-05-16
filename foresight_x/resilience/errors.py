"""Shared resilience exception types."""


class DependencyDegraded(Exception):
    """Raised when a dependency is intentionally unavailable (chaos or circuit open)."""

    def __init__(
        self,
        target: str,
        *,
        status: int = 503,
        reason: str = "dependency_degraded",
        retryable: bool = True,
    ) -> None:
        self.target = (target or "unknown").strip()
        self.status = int(status)
        self.reason = (reason or "dependency_degraded").strip()
        self.retryable = bool(retryable)
        super().__init__(f"{self.target}: {self.reason} (status={self.status})")
