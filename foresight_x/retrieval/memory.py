"""Per-user decision memory: Chroma + LlamaIndex -> `MemoryBundle`."""

from __future__ import annotations

import json
import re
from typing import Any

import chromadb
from llama_index.core import Document, StorageContext, VectorStoreIndex
from llama_index.core.base.embeddings.base import BaseEmbedding
from llama_index.vector_stores.chroma import ChromaVectorStore

from foresight_x.config import Settings, load_settings
from foresight_x.retrieval._embeddings import build_openai_embedding
from foresight_x.schemas import (
    DecisionOutcome,
    DecisionTrace,
    MemoryBundle,
    PastDecision,
    UserState,
)


def _sanitize_id(user_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", user_id.strip())[:120]


def _collection_name(user_id: str) -> str:
    return f"fx_mem_{_sanitize_id(user_id)}"


def _chroma_metadata(meta: dict[str, Any]) -> dict[str, str | int | float | bool]:
    """Chroma accepts only scalar metadata; encode structures as JSON strings."""
    out: dict[str, str | int | float | bool] = {}
    for key, val in meta.items():
        if val is None:
            continue
        if isinstance(val, (str, int, float, bool)):
            out[key] = val
        else:
            out[key] = json.dumps(val, ensure_ascii=False)
    return out


def _decode_meta(md: dict[str, Any]) -> dict[str, Any]:
    out = dict(md)
    raw = out.get("behavioral_patterns_json")
    if isinstance(raw, str) and raw:
        try:
            out["behavioral_patterns"] = json.loads(raw)
        except json.JSONDecodeError:
            out["behavioral_patterns"] = []
    return out


class UserMemory:
    """Persisted vector index of past decisions for one user."""

    def __init__(
        self,
        user_id: str,
        *,
        settings: Settings | None = None,
        embed_model: BaseEmbedding | None = None,
        collection_name: str | None = None,
    ) -> None:
        self.user_id = user_id
        self.settings = settings or load_settings()
        self.embed_model = embed_model or build_openai_embedding(self.settings)
        self._collection_key = collection_name or _collection_name(user_id)

        self.settings.chroma_persist_dir.mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(path=str(self.settings.chroma_persist_dir))
        self._collection = self._client.get_or_create_collection(name=self._collection_key)
        store = ChromaVectorStore(chroma_collection=self._collection)
        ctx = StorageContext.from_defaults(vector_store=store)
        self._index = VectorStoreIndex.from_vector_store(
            vector_store=store,
            storage_context=ctx,
            embed_model=self.embed_model,
        )

    def add_past_decision(
        self,
        past: PastDecision,
        *,
        behavioral_patterns: list[str] | None = None,
    ) -> None:
        lines = [
            past.situation_summary,
            f"Chosen option: {past.chosen_option}",
        ]
        if past.outcome:
            lines.append(f"Outcome: {past.outcome}")
        text = "\n".join(lines)
        meta: dict[str, Any] = {
            "kind": "past_decision",
            "decision_id": past.decision_id,
            "situation_summary": past.situation_summary,
            "chosen_option": past.chosen_option,
            "outcome": past.outcome or "",
            "outcome_quality": past.outcome_quality if past.outcome_quality is not None else -1,
            "timestamp": past.timestamp,
        }
        if behavioral_patterns:
            meta["behavioral_patterns_json"] = json.dumps(behavioral_patterns, ensure_ascii=False)
        self._index.insert(Document(text=text, metadata=_chroma_metadata(meta)))

    def add_decision(self, trace: DecisionTrace, outcome: DecisionOutcome | None = None) -> None:
        label = next(
            (o.name for o in trace.options if o.option_id == trace.recommendation.chosen_option_id),
            trace.recommendation.chosen_option_id,
        )
        past = PastDecision(
            decision_id=trace.decision_id,
            situation_summary=trace.user_state.raw_input[:2000],
            chosen_option=label,
            outcome=outcome.actual_outcome if outcome else None,
            outcome_quality=outcome.user_reported_quality if outcome else None,
            timestamp=outcome.timestamp if outcome else trace.timestamp,
        )
        patterns = list(trace.memory.behavioral_patterns) if trace.memory else []
        self.add_past_decision(past, behavioral_patterns=patterns or None)

    def retrieve(self, user_state: UserState, top_k: int = 5) -> MemoryBundle:
        query = " ".join(
            [
                user_state.decision_type,
                " ".join(user_state.goals),
                user_state.current_behavior,
                user_state.raw_input[:1500],
            ]
        )
        retriever = self._index.as_retriever(similarity_top_k=top_k)
        nodes = retriever.retrieve(query)

        pasts: list[PastDecision] = []
        patterns_acc: list[str] = []
        outcome_snippets: list[str] = []
        seen_pat: set[str] = set()

        for node in nodes:
            md = _decode_meta(node.metadata or {})
            if md.get("kind") != "past_decision" and not md.get("decision_id"):
                continue
            did = md.get("decision_id")
            if not did:
                continue
            oq = md.get("outcome_quality")
            if isinstance(oq, (int, float)) and int(oq) == -1:
                pq: int | None = None
            elif isinstance(oq, (int, float)):
                pq = int(oq)
            else:
                pq = None

            pasts.append(
                PastDecision(
                    decision_id=str(did),
                    situation_summary=str(md.get("situation_summary", node.text[:800])),
                    chosen_option=str(md.get("chosen_option", "")),
                    outcome=str(md["outcome"]) if md.get("outcome") else None,
                    outcome_quality=pq,
                    timestamp=str(md.get("timestamp", "")),
                )
            )
            bplist = md.get("behavioral_patterns")
            if isinstance(bplist, list):
                for p in bplist:
                    s = str(p)
                    if s not in seen_pat:
                        seen_pat.add(s)
                        patterns_acc.append(s)
            outv = md.get("outcome")
            if outv:
                outcome_snippets.append(str(outv))

        summary = (
            " ".join(outcome_snippets[:6])
            if outcome_snippets
            else "No strong outcome signal in top retrieved memories."
        )
        return MemoryBundle(
            similar_past_decisions=pasts,
            behavioral_patterns=patterns_acc,
            prior_outcomes_summary=summary[:2000],
        )
