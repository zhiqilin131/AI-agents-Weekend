"""Embedding model factory for LlamaIndex indices (OpenAI or injected in tests)."""

from __future__ import annotations

from llama_index.core.base.embeddings.base import BaseEmbedding
from llama_index.embeddings.openai import OpenAIEmbedding

from foresight_x.config import Settings, load_settings


def build_openai_embedding(settings: Settings | None = None) -> OpenAIEmbedding:
    """OpenAI text embeddings for Chroma-backed vector stores."""
    s = settings or load_settings()
    kwargs: dict = {
        "model": s.openai_embedding_model,
        "api_key": s.openai_api_key or None,
    }
    if s.openai_api_base:
        kwargs["api_base"] = s.openai_api_base
    return OpenAIEmbedding(**kwargs)
