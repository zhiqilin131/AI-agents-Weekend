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
from foresight_x.retrieval.baseline_relevance import keep_baseline_fact
from foresight_x.retrieval.memory_query import build_unified_vector_query
from foresight_x.retrieval.query_text import profile_snippet_for_retrieval
from foresight_x.retrieval.tavily_client import TavilyGateway, build_tavily_query_for_decision
from foresight_x.schemas import EvidenceBundle, Fact, UserState


def _world_node_text(node: Any) -> str:
    inner = getattr(node, "node", None)
    if inner is not None:
        return str(getattr(inner, "text", "") or "")
    return str(getattr(node, "text", "") or "")


def _world_node_metadata(node: Any) -> dict[str, Any]:
    inner = getattr(node, "node", None)
    if inner is not None and getattr(inner, "metadata", None):
        return dict(inner.metadata)
    return dict(getattr(node, "metadata", None) or {})


def _normalize_world_score(score: float | None, rank: int) -> float:
    if score is None:
        return 1.0 / (rank + 1)
    s = float(score)
    if 0.0 <= s <= 1.0:
        return max(0.04, s)
    if s > 1.0:
        return max(0.04, 1.0 / (1.0 + s))
    return max(0.04, min(1.0, s))


def _should_emit_packaged_world_fact(user_state: UserState, text: str, md: dict[str, Any]) -> bool:
    """Hide packaged career demo snippets when the decision is clearly not career-shaped."""
    v = md.get("packaged_seed")
    is_seed = v is True or v == 1 or str(v).lower() in ("true", "1", "yes")
    if not is_seed and "career decision cache (demo)" not in (text or "").lower():
        return True
    if not is_seed and "career decision cache (demo)" in (text or "").lower():
        is_seed = True
    if not is_seed:
        return True
    dt = (user_state.decision_type or "general").lower()
    if dt in ("career", "academic"):
        return True
    return False


def _world_seed_multiplier(user_state: UserState, text: str, md: dict[str, Any]) -> float:
    """Downrank packaged career demo chunks when the query is not career-shaped."""
    v = md.get("packaged_seed")
    is_seed = v is True or v == 1 or str(v).lower() in ("true", "1", "yes")
    if not is_seed and "career decision cache (demo)" in (text or "").lower():
        is_seed = True
    if not is_seed:
        return 1.0
    dt = (user_state.decision_type or "general").lower()
    if dt in ("career", "academic"):
        return 0.86
    if dt in ("financial", "health"):
        return 0.5
    return 0.32


def _dedupe_facts_by_text(items: list[Fact]) -> list[Fact]:
    """Drop near-duplicate snippets (common when the vector store returns overlapping chunks)."""
    seen: set[str] = set()
    out: list[Fact] = []
    for f in items:
        key = " ".join(f.text.split()).strip().lower()[:6000]
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out


def _tavily_fact_as_base_rate(wf: Fact) -> Fact:
    """Turn a web snippet into a query-aligned base-rate line for the UI (not a static seed)."""
    body = (wf.text or "").strip()
    if len(body) > 1500:
        body = body[:1497] + "..."
    line = f"Live reference (aligned to your question): {body}"
    conf = wf.confidence if isinstance(wf.confidence, (int, float)) else 0.75
    return Fact(text=line, source_url=wf.source_url, confidence=min(0.82, float(conf)))


def _is_removed_packaged_internship_base_rate(text: str) -> bool:
    """Old demo seed still present in persisted Chroma; drop it so live/Tavily lines dominate base_rates."""
    t = (text or "").lower()
    return "many students receive only one strong internship offer" in t


def _is_placeholder_source_url(url: str | None) -> bool:
    u = (url or "").strip().lower()
    if not u:
        return False
    return "example.test" in u


def _is_placeholder_world_fact_text(text: str) -> bool:
    """Filter integration-test placeholder snippets only — not real seed files (they may mention the demo title)."""
    t = (text or "").strip().lower()
    return "external labor market note" in t


def _is_web_source_url(url: str | None) -> bool:
    """Tavily and other web hits carry http(s) URLs; route these to baseline-style bundle, not \"news\"."""
    u = (url or "").strip().lower()
    return u.startswith("http://") or u.startswith("https://")


def _meta_truthy(val: Any) -> bool:
    if val is True:
        return True
    if isinstance(val, (int, float)) and val == 1:
        return True
    s = str(val).strip().lower()
    return s in ("true", "1", "yes")


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
        packaged_seed: bool = False,
    ) -> None:
        """Insert a cached knowledge snippet (used by seeding and tests)."""
        meta: dict[str, Any] = {
            "kind": kind,
            "source_url": source_url or "",
            "confidence": confidence,
            "doc_id": str(uuid.uuid4()),
        }
        if packaged_seed:
            meta["packaged_seed"] = True
        self._index.insert(Document(text=text, metadata=_scalar_metadata(meta)))

    def _ingest_tavily_facts(self, facts: list[Fact]) -> None:
        """Store web results as ``web_reference`` so retrieval surfaces them under baseline, not \"recent news\"."""
        for f in facts:
            meta = _scalar_metadata(
                {
                    "kind": "web_reference",
                    "from_tavily": True,
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
        min_cache_hits: int | None = None,
        top_k: int = 8,
    ) -> EvidenceBundle:
        extra = profile_snippet_for_retrieval(user_state)
        # Same embedding query string as ``UserMemory`` (Chroma alignment).
        query = build_unified_vector_query(user_state)
        # Dedicated string for live web search (user question first — avoids irrelevant cached baselines).
        tavily_query = build_tavily_query_for_decision(user_state, extra)
        fetch_k = min(36, max(top_k * 4, 16))
        retriever = self._index.as_retriever(similarity_top_k=fetch_k)
        raw_nodes = retriever.retrieve(query)

        ranked: list[tuple[float, Any]] = []
        for rank, node in enumerate(raw_nodes):
            md = _world_node_metadata(node)
            txt = _world_node_text(node)
            sim = _normalize_world_score(getattr(node, "score", None), rank)
            mult = _world_seed_multiplier(user_state, txt, md)
            ranked.append((sim * mult, node))
        ranked.sort(key=lambda x: x[0], reverse=True)
        nodes = [n for _, n in ranked[:top_k]]

        m = self.settings.tavily_min_cache_hits if min_cache_hits is None else min_cache_hits

        # Default ``tavily_fresh_each_run``: always call Tavily when configured, so baselines match *this*
        # question instead of skipping because Chroma has unrelated prior ingests (e.g. academic seeds).
        if self._tavily is None:
            need_tavily = False
        elif self.settings.tavily_fresh_each_run or self.settings.tavily_always:
            need_tavily = True
        else:
            need_tavily = len(raw_nodes) < m or _time_sensitive(user_state)
            if not need_tavily:
                non_placeholder = 0
                for node in raw_nodes:
                    md = _world_node_metadata(node)
                    txt = _world_node_text(node)
                    surl = str(md.get("source_url") or "").strip()
                    if _is_placeholder_source_url(surl):
                        continue
                    if _is_placeholder_world_fact_text(txt):
                        continue
                    non_placeholder += 1
                if non_placeholder < m:
                    need_tavily = True

        web_facts: list[Fact] = []
        tavily_urls: set[str] = set()
        if need_tavily:
            web_facts = self._tavily.search_as_facts(tavily_query)
            self._ingest_tavily_facts(web_facts)
            for wf in web_facts:
                u = (wf.source_url or "").strip()
                if u:
                    tavily_urls.add(u)

        facts: list[Fact] = []
        chroma_base_rates: list[Fact] = []
        recent_events: list[Fact] = []

        for node in nodes:
            md = _world_node_metadata(node)
            txt = _world_node_text(node)
            if not _should_emit_packaged_world_fact(user_state, txt, md):
                continue
            kind = str(md.get("kind", "fact"))
            fact = self._node_to_fact(txt, md)
            if _is_placeholder_source_url(fact.source_url) or _is_placeholder_world_fact_text(fact.text):
                continue
            if kind == "base_rate":
                if _is_removed_packaged_internship_base_rate(fact.text):
                    continue
                chroma_base_rates.append(fact)
            elif kind == "web_reference" or _meta_truthy(md.get("from_tavily")):
                # Cached web snippets — keep as secondary baselines after this run's fresh Tavily hits.
                chroma_base_rates.append(_tavily_fact_as_base_rate(fact))
            elif kind in ("recent_event", "event"):
                surl = str(md.get("source_url") or "").strip()
                if surl and surl in tavily_urls:
                    continue
                # Legacy index rows: Tavily used to ingest as ``recent_event``; still treat http(s) as web baselines.
                if _is_web_source_url(surl):
                    chroma_base_rates.append(_tavily_fact_as_base_rate(fact))
                else:
                    recent_events.append(fact)
            else:
                facts.append(fact)

        if self._tavily is not None and not web_facts and not facts and not chroma_base_rates and not recent_events:
            # Last-resort freshness guard: local cache returned nothing usable after filtering.
            web_facts = self._tavily.search_as_facts(tavily_query)
            self._ingest_tavily_facts(web_facts)

        kept_web = [wf for wf in web_facts if keep_baseline_fact(user_state, wf, tavily_query=tavily_query)]
        fresh_baselines = [_tavily_fact_as_base_rate(wf) for wf in kept_web]
        chroma_filtered = [
            f for f in chroma_base_rates if keep_baseline_fact(user_state, f, tavily_query=tavily_query)
        ]
        # Fresh Tavily lines first; drop unrelated cached web chunks (e.g. old academic-integrity ingests).
        base_rates = _dedupe_facts_by_text(fresh_baselines + chroma_filtered)

        return EvidenceBundle(
            facts=_dedupe_facts_by_text(facts),
            base_rates=base_rates,
            recent_events=_dedupe_facts_by_text(recent_events),
        )
