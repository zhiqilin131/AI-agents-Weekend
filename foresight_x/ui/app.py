"""Minimal Streamlit app for Foresight-X demo."""

from __future__ import annotations

from foresight_x.config import load_settings
from foresight_x.orchestration.pipeline import run_pipeline
from foresight_x.ui.cli import _build_context, render_trace_sections


def run_streamlit_app() -> None:
    try:
        import streamlit as st
    except ImportError as exc:  # pragma: no cover - optional runtime dependency
        raise RuntimeError("Streamlit is not installed. Run: pip install streamlit") from exc

    st.set_page_config(page_title="Foresight-X", layout="wide")
    st.title("Foresight-X")
    st.caption("Evidence-grounded decision agent")

    settings = load_settings()
    raw_input = st.text_area(
        "Decision input",
        placeholder="I got an offer from Company X, they want an answer by Friday...",
        height=140,
    )
    run_clicked = st.button("Run Foresight-X")

    if run_clicked and raw_input.strip():
        ctx, notes = _build_context(settings)
        trace = run_pipeline(ctx, raw_input, persist_trace=True)

        for note in notes:
            st.info(note)

        st.subheader("7-section output")
        st.text(render_trace_sections(trace))

        st.subheader("Trace JSON")
        st.json(trace.model_dump(mode="json"), expanded=False)

        st.success(f"Trace saved to {settings.traces_dir / (trace.decision_id + '.json')}")


if __name__ == "__main__":
    run_streamlit_app()
