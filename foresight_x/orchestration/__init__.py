"""Orchestration: workflow and synchronous pipeline (import submodules directly to avoid heavy eager loads)."""

from __future__ import annotations

__all__ = [
    "PipelineContext",
    "finalize_trace",
    "retrieve_bundles",
    "run_pipeline",
    "step_infer",
    "utc_timestamp",
    "ForesightStartEvent",
    "ForesightWorkflow",
    "run_pipeline_workflow",
]


def __getattr__(name: str):
    if name in (
        "PipelineContext",
        "finalize_trace",
        "retrieve_bundles",
        "run_pipeline",
        "step_infer",
        "utc_timestamp",
    ):
        from foresight_x.orchestration import pipeline as _p

        return getattr(_p, name)
    if name in ("ForesightStartEvent", "ForesightWorkflow", "run_pipeline_workflow"):
        from foresight_x.orchestration import workflow as _w

        return getattr(_w, name)
    raise AttributeError(name)
