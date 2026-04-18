"""World knowledge: Chroma cache + Tavily fallback -> `EvidenceBundle`."""

from __future__ import annotations

import json
import uuid
from typing import Any

import chromadb
from llama_index.core import Document, StorageContext, VectorStoreIndex
from llama_index.core.base.embeddings.base import BaseEmbedding
from llama_index.vector_stores.chroma import ChromaVectorStore

from foresight_x.config import Settings, load_settings
from foresight_x.retrieval._embeddings import build_openai_embedding
from foresight_x.retrieval.tavily_client import TavilyGateway
from foresight_x.schemas import EvidenceBundle, Fact, UserState


def _scalar_metadata(meta: dict[str, Any]) -> dict[str, str | int | float | bool]:
    out: dict[str, str | int | float | bool] = {}
    for k, v in meta.items():
        if v is None:
            continue
        if isinstance(v, (str, int, float, bool)):
            out[k] = v
        else:
            out[k] = json.dumps(v, ensure_ascii=False)
    return out


TIME_SENSITIVE_DECISION_TYPES = frozenset(
    {"career", "financial", "health", "academic"},
)


def _time_sensitive(user_state: UserState) -> bool:
    if user_state.decision_type.lower() in TIME_SENSITIVE_DECISION_TYPES:
        return True
    if user_state.deadline_hint:
        return True
    return False


class WorldKnowledge:
    """Hybrid retrieval: local Chroma cache, optional Tavily for freshness."""

    DEFAULT_COLLECTION = "fx_world_global"

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        embed_model: BaseEmbedding | None = None,
        collection_name: str | None = None,
        tavily: TavilyGateway | None = None,
    ) -> None:
        self.settings = settings or load_settings()
        self.embed_model = embed_model or build_openai_embedding(self.settings)
        self._collection_name = collection_name or self.DEFAULT_COLLECTION
        self._tavily = tavily

        self.settings.chroma_persist_dir.mkdir(parents=True, exist_ok=True)
        client = chromadb.PersistentClient(path=str(self.settings.chroma_persist_dir))
        collection = client.get_or_create_collection(name=self._collection_name)
        store = ChromaVectorStore(chroma_collection=collection)
        ctx = StorageContext.from_defaults(vector_store=store)
        self._index = VectorStoreIndex.from_vector_store(
            vector_store=store,
            storage_context=ctx,
            embed_model=self.embed_model,
        )

    def insert_text(
        self,
        text: str,
        *,
        kind: str = "fact",
        source_url: str | None = None,
        confidence: float = 0.85,
    ) -> None:
        """Insert a cached knowledge snippet (used by seeding and tests)."""
        meta: dict[str, Any] = {
            "kind": kind,
            "source_url": source_url or "",
            "confidence": confidence,
            "doc_id": str(uuid.uuid4()),
        }
        self._index.insert(Document(text=text, metadata=_scalar_metadata(meta)))

    def _ingest_tavily_facts(self, facts: list[Fact]) -> None:
        for f in facts:
            meta = _scalar_metadata(
                {
                    "kind": "recent_event",
                    "source_url": f.source_url or "",
                    "confidence": f.confidence,
                    "doc_id": str(uuid.uuid4()),
                }
            )
            self._index.insert(Document(text=f.text, metadata=meta))

    @staticmethod
    def _node_to_fact(text: str, metadata: dict[str, Any]) -> Fact:
        url = metadata.get("source_url") or None
        if url == "":
            url = None
        conf = metadata.get("confidence")
        if isinstance(conf, (int, float)):
            c = float(conf)
        else:
            c = 0.85
        return Fact(text=text[:8000], source_url=str(url) if url else None, confidence=c)

    def retrieve(
        self,
        user_state: UserState,
        *,
        min_cache_hits: int = 3,
        top_k: int = 8,
    ) -> EvidenceBundle:
        query = " ".join(
            [
                user_state.decision_type,
                " ".join(user_state.goals),
                user_state.raw_input[:2000],
            ]
        )
        retriever = self._index.as_retriever(similarity_top_k=top_k)
        nodes = retriever.retrieve(query)

        facts: list[Fact] = []
        base_rates: list[Fact] = []
        recent_events: list[Fact] = []

        for node in nodes:
            md = dict(node.metadata or {})
            kind = str(md.get("kind", "fact"))
            fact = self._node_to_fact(node.text, md)
            if kind == "base_rate":
                base_rates.append(fact)
            elif kind in ("recent_event", "event"):
                recent_events.append(fact)
            else:
                facts.append(fact)

        need_tavily = len(nodes) < min_cache_hits or _time_sensitive(user_state)
        if need_tavily and self._tavily is not None:
            extra = self._tavily.search_as_facts(query)
            self._ingest_tavily_facts(extra)
            recent_events.extend(extra)

        return EvidenceBundle(
            facts=facts,
            base_rates=base_rates,
            recent_events=recent_events,
        )
