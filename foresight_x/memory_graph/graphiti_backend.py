"""Graphiti-backed temporal knowledge graph memory (industrial backend).

Design:
- Single Graphiti instance per user on an embedded Kuzu database (zero deployment).
- All Graphiti coroutines run on one dedicated event-loop thread (Kuzu is
  single-writer; this serializes access without blocking the request path).
- Ingestion (LLM entity extraction) is queued to a background worker so the
  decision pipeline never waits on it. An on-disk ledger makes ingest idempotent.
- Retrieval uses Graphiti hybrid search (BM25 + embedding cosine + graph BFS,
  reciprocal-rank-fusion rerank) and maps results into ``GraphInfluenceBundle``
  so every existing consumer (recommender, report UI) works unchanged.
- Any failure surfaces as ``None`` so callers fall back to the legacy PPR graph.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import queue
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from foresight_x.config import Settings, load_settings
from foresight_x.schemas import DecisionOutcome, DecisionTrace, GraphInfluenceBundle, InfluenceNode, UserState

_log = logging.getLogger("foresight_x.graphiti")

_INGEST_QUEUE_MAX = 256
_INGEST_LEDGER_MAX = 5000

# Graphiti's default prompt is tuned for named-entity corpora ("could it have a
# Wikipedia article?") and bans relational/life-event terms, which yields zero
# entities for personal journal content. This override re-tunes it.
_EXTRACTION_INSTRUCTIONS = (
    "IMPORTANT OVERRIDE: This text is a personal memory journal about the user's life and "
    "decisions, not a news corpus. The earlier restrictions are relaxed as follows: DO extract "
    '(a) possessor-qualified personal relations such as "the user\'s girlfriend" / "用户的女朋友"; '
    '(b) specific life events, activities and decisions such as "breakup" / "分手", "job offer", '
    '"salmon dinner"; (c) concrete topics, places, foods, organizations the user mentions. '
    "Keep entity names in the original language of the text. "
    'Refer to the speaker as "user" when they appear. Aim for 2-6 entities per text.'
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(iso: str | None) -> datetime:
    raw = (iso or "").strip()
    if not raw:
        return _utc_now()
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return _utc_now()


def _sanitize_group(user_id: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in user_id)[:64] or "default"


def graphiti_available(settings: Settings) -> bool:
    """Backend is usable when graphiti-core imports and an OpenAI key exists."""
    if not (settings.openai_api_key or "").strip():
        return False
    try:
        import graphiti_core  # noqa: F401

        return True
    except Exception:
        return False


@dataclass
class _Episode:
    key: str
    name: str
    body: str
    source_description: str
    reference_time: datetime
    source: str = "text"  # "text" | "message" | "json"
    metadata: dict[str, Any] = field(default_factory=dict)


class GraphitiMemoryBackend:
    """Per-user Graphiti wrapper with sync facade, background ingest, and hard timeouts."""

    def __init__(self, user_id: str, settings: Settings) -> None:
        self.settings = settings
        self.user_id = user_id
        self.group_id = _sanitize_group(user_id)
        self._lock = threading.Lock()
        self._graphiti: Any | None = None
        self._init_error: str | None = None
        self._init_error_at: float = 0.0
        self._initialized = False

        self._loop = asyncio.new_event_loop()
        self._loop_thread = threading.Thread(
            target=self._loop.run_forever, name=f"graphiti-loop-{self.group_id}", daemon=True
        )
        self._loop_thread.start()

        self._ingest_queue: queue.Queue[_Episode] = queue.Queue(maxsize=_INGEST_QUEUE_MAX)
        self._ingest_thread = threading.Thread(
            target=self._ingest_worker, name=f"graphiti-ingest-{self.group_id}", daemon=True
        )
        self._ingest_thread.start()
        self._ingested_keys: set[str] = self._load_ledger()
        self._ingest_errors = 0
        self._ingest_done = 0
        self._last_error: str | None = None

    # ---------- lifecycle ----------

    @property
    def db_path(self) -> str:
        self.settings.graphiti_dir.mkdir(parents=True, exist_ok=True)
        return str(self.settings.graphiti_dir / f"{self.group_id}.kuzu")

    @property
    def _ledger_path(self) -> str:
        self.settings.graphiti_dir.mkdir(parents=True, exist_ok=True)
        return str(self.settings.graphiti_dir / f"{self.group_id}.ingest.json")

    def _load_ledger(self) -> set[str]:
        try:
            with open(self._ledger_path, encoding="utf-8") as f:
                data = json.load(f)
            return set(str(x) for x in data.get("keys", []))
        except Exception:
            return set()

    def _save_ledger(self) -> None:
        try:
            keys = list(self._ingested_keys)[-_INGEST_LEDGER_MAX:]
            with open(self._ledger_path, "w", encoding="utf-8") as f:
                json.dump({"keys": keys}, f)
        except Exception:
            _log.debug("graphiti ledger save failed", exc_info=True)

    _INIT_RETRY_COOLDOWN_S = 120.0

    def _ensure_client(self) -> Any | None:
        """Lazily build the Graphiti client + indices on first use (thread-safe).

        Init failures (e.g. another process holds the Kuzu file lock during a
        backfill) are retried after a cooldown instead of being cached forever.
        """
        if self._graphiti is not None:
            return self._graphiti
        if self._init_error is not None and (
            _utc_now().timestamp() - self._init_error_at < self._INIT_RETRY_COOLDOWN_S
        ):
            return None
        with self._lock:
            if self._graphiti is not None:
                return self._graphiti
            if self._init_error is not None and (
                _utc_now().timestamp() - self._init_error_at < self._INIT_RETRY_COOLDOWN_S
            ):
                return None
            try:
                import os
                import warnings

                if not os.environ.get("OPENAI_API_KEY") and self.settings.openai_api_key:
                    os.environ["OPENAI_API_KEY"] = self.settings.openai_api_key

                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", DeprecationWarning)
                    from graphiti_core import Graphiti
                    from graphiti_core.driver.kuzu_driver import KuzuDriver
                    from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
                    from graphiti_core.llm_client import OpenAIClient
                    from graphiti_core.llm_client.config import LLMConfig

                    api_key = self.settings.openai_api_key or os.environ.get("OPENAI_API_KEY", "")
                    model = self.settings.openai_model or "gpt-4o-mini"
                    driver = KuzuDriver(db=self.db_path)
                    client = Graphiti(
                        graph_driver=driver,
                        llm_client=OpenAIClient(
                            config=LLMConfig(api_key=api_key, model=model, small_model=model, temperature=0)
                        ),
                        embedder=OpenAIEmbedder(
                            config=OpenAIEmbedderConfig(
                                api_key=api_key,
                                embedding_model=self.settings.openai_embedding_model or "text-embedding-3-small",
                            )
                        ),
                    )
                self._run(client.build_indices_and_constraints(), timeout=30.0)
                self._ensure_kuzu_fts_indices(driver)
                self._graphiti = client
                self._initialized = True
                self._init_error = None
                _log.info("graphiti backend ready user=%s db=%s", self.user_id, self.db_path)
            except Exception as exc:
                self._init_error = f"{type(exc).__name__}: {exc}"
                self._init_error_at = _utc_now().timestamp()
                self._last_error = self._init_error
                _log.warning("graphiti init failed user=%s: %s", self.user_id, self._init_error)
                return None
        return self._graphiti

    def _ensure_kuzu_fts_indices(self, driver: Any) -> None:
        """graphiti 0.29's KuzuDriver.build_indices_and_constraints is a no-op, so the
        BM25 full-text indices required by hybrid search are never created. Create them
        here (idempotent: existing-index errors are ignored)."""
        try:
            from graphiti_core.driver.driver import GraphProvider
            from graphiti_core.graph_queries import get_fulltext_indices

            existing: set[str] = set()
            try:
                rows, _, _ = self._run(
                    driver.execute_query("CALL SHOW_INDEXES() RETURN index_name AS name"),
                    timeout=10.0,
                )
                existing = {str(r.get("name", "")) for r in rows or []}
            except Exception:
                pass
            for query in get_fulltext_indices(GraphProvider.KUZU):
                if existing and any(f"'{name}'" in query for name in existing if name):
                    continue
                try:
                    self._run(driver.execute_query(query), timeout=30.0)
                except Exception as exc:
                    if "already exists" not in str(exc).lower():
                        raise
        except Exception as exc:
            raise RuntimeError(f"kuzu FTS index setup failed: {exc}") from exc

    def _run(self, coro: Any, *, timeout: float) -> Any:
        fut = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return fut.result(timeout=timeout)

    # ---------- ingestion (non-blocking, idempotent) ----------

    def _enqueue(self, ep: _Episode) -> bool:
        if not self.settings.graphiti_ingest_enabled:
            return False
        if ep.key in self._ingested_keys:
            return False
        try:
            self._ingest_queue.put_nowait(ep)
            return True
        except queue.Full:
            self._last_error = "ingest_queue_full"
            _log.warning("graphiti ingest queue full; dropping episode %s", ep.name)
            return False

    def _ingest_worker(self) -> None:
        while True:
            ep = self._ingest_queue.get()
            try:
                if ep.key in self._ingested_keys:
                    continue
                client = self._ensure_client()
                if client is None:
                    continue
                from graphiti_core.nodes import EpisodeType

                src = {
                    "message": EpisodeType.message,
                    "json": EpisodeType.json,
                }.get(ep.source, EpisodeType.text)
                self._run(
                    client.add_episode(
                        name=ep.name,
                        episode_body=ep.body,
                        source_description=ep.source_description,
                        reference_time=ep.reference_time,
                        source=src,
                        custom_extraction_instructions=_EXTRACTION_INSTRUCTIONS,
                        # group_id intentionally omitted: Kuzu uses the provider default
                        # (isolation comes from one DB file per user); passing a custom
                        # group_id triggers a Neo4j-only clone path in graphiti 0.29.
                    ),
                    timeout=120.0,
                )
                self._ingested_keys.add(ep.key)
                self._ingest_done += 1
                self._save_ledger()
            except Exception as exc:
                self._ingest_errors += 1
                self._last_error = f"ingest:{type(exc).__name__}: {exc}"
                _log.warning("graphiti ingest failed for %s: %s", ep.name, exc)
            finally:
                self._ingest_queue.task_done()

    def enqueue_decision_trace(self, trace: DecisionTrace) -> None:
        us = trace.user_state
        chosen = ""
        if trace.recommendation is not None:
            by_id = {o.option_id: o.name for o in trace.options}
            chosen = by_id.get(trace.recommendation.chosen_option_id, "")
        lines = [
            f"The user made a decision ({us.decision_type}).",
            f"User said: {trace.original_user_input or us.raw_input}",
        ]
        if us.goals:
            lines.append("Goals: " + "; ".join(us.goals[:6]))
        if trace.options:
            lines.append("Options considered: " + "; ".join(o.name for o in trace.options[:6]))
        if chosen:
            lines.append(f"Recommended option: {chosen}")
        if trace.recommendation is not None and trace.recommendation.reasoning:
            lines.append(f"Reasoning: {trace.recommendation.reasoning[:500]}")
        self._enqueue(
            _Episode(
                key=f"decision:{trace.decision_id}",
                name=f"decision:{trace.decision_id}",
                body="\n".join(lines)[:6000],
                source_description="foresight decision trace",
                reference_time=_parse_ts(trace.timestamp),
            )
        )

    def enqueue_outcome(self, trace: DecisionTrace, outcome: DecisionOutcome) -> None:
        body = (
            f"Outcome for an earlier decision: quality={outcome.user_reported_quality}/5, "
            f"took_recommended={outcome.user_took_recommended_action}, "
            f"reversed_later={outcome.reversed_later}. "
            f"What happened: {outcome.actual_outcome[:1500]}"
        )
        self._enqueue(
            _Episode(
                key=f"outcome:{trace.decision_id}:{outcome.timestamp}",
                name=f"outcome:{trace.decision_id}",
                body=body,
                source_description="foresight decision outcome",
                reference_time=_parse_ts(outcome.timestamp),
            )
        )

    def enqueue_shadow_turn(self, user_text: str, assistant_text: str, *, timestamp: str | None = None) -> None:
        ts = (timestamp or "").strip() or _utc_now().isoformat()
        digest = hashlib.sha1(f"{user_text}|{assistant_text}|{ts}".encode("utf-8")).hexdigest()[:18]
        body = f"user: {user_text[:2000]}\nassistant: {assistant_text[:1500]}"
        self._enqueue(
            _Episode(
                key=f"shadow:{digest}",
                name=f"shadow:{digest}",
                body=body,
                source_description="shadow chat turn",
                reference_time=_parse_ts(ts),
                source="message",
            )
        )

    def enqueue_external_event(self, text: str, *, timestamp: str | None = None, event_type: str = "external_event") -> None:
        ts = (timestamp or "").strip() or _utc_now().isoformat()
        digest = hashlib.sha1(f"{text}|{ts}|{event_type}".encode("utf-8")).hexdigest()[:18]
        self._enqueue(
            _Episode(
                key=f"external:{event_type}:{digest}",
                name=f"external:{event_type}:{digest}",
                body=text[:4000],
                source_description=event_type,
                reference_time=_parse_ts(ts),
            )
        )

    # ---------- retrieval ----------

    def influence_for(self, user_state: UserState, *, top_k: int = 8) -> GraphInfluenceBundle | None:
        client = self._ensure_client()
        if client is None:
            return None
        query = " ".join(
            x
            for x in [
                user_state.raw_input or "",
                " ".join(user_state.goals or []),
            ]
            if x.strip()
        ).strip()
        if not query:
            return None
        try:
            from graphiti_core.search.search_config_recipes import COMBINED_HYBRID_SEARCH_RRF

            config = COMBINED_HYBRID_SEARCH_RRF.model_copy(deep=True)
            config.limit = max(top_k, 10)
            # Default 0.6 cosine floor is tuned for long English entity names; short /
            # cross-language names (e.g. "分手" vs a full sentence query) score lower.
            # RRF ordering still ranks by relevance; we just widen the candidate pool.
            for sub in (config.node_config, config.edge_config, config.episode_config, config.community_config):
                if sub is not None:
                    sub.sim_min_score = 0.3
            results = self._run(
                client.search_(query, config=config),
                timeout=self.settings.graphiti_search_timeout_s,
            )
        except Exception as exc:
            self._last_error = f"search:{type(exc).__name__}: {exc}"
            _log.warning("graphiti search failed: %s", exc)
            return None
        return self._to_bundle(results, top_k=top_k)

    def _to_bundle(self, results: Any, *, top_k: int) -> GraphInfluenceBundle | None:
        nodes = list(getattr(results, "nodes", None) or [])
        edges = list(getattr(results, "edges", None) or [])
        episodes = list(getattr(results, "episodes", None) or [])
        node_scores = list(getattr(results, "node_reranker_scores", None) or [])
        edge_scores = list(getattr(results, "edge_reranker_scores", None) or [])
        if not nodes and not edges and not episodes:
            return None

        fact_by_node: dict[str, str] = {}
        for e in edges:
            for uuid in (e.source_node_uuid, e.target_node_uuid):
                if uuid not in fact_by_node and (e.fact or "").strip():
                    fact_by_node[uuid] = e.fact.strip()

        raw_scores = [s for s in node_scores if isinstance(s, (int, float))]
        max_s = max(raw_scores) if raw_scores else 0.0

        top_nodes: list[InfluenceNode] = []
        for i, n in enumerate(nodes[: top_k * 2]):
            score = float(node_scores[i]) if i < len(node_scores) else 0.0
            norm = score / max_s if max_s > 0 else 0.5
            label = (n.name or "").strip() or "entity"
            summary = (getattr(n, "summary", "") or "").strip()
            why = fact_by_node.get(n.uuid) or summary[:160] or "Semantically related to your current situation."
            labels = [x for x in (getattr(n, "labels", None) or []) if x and x != "Entity"]
            top_nodes.append(
                InfluenceNode(
                    node_id=f"graphiti:{n.uuid}",
                    label=label[:120],
                    node_type=(labels[0].lower() if labels else "entity"),
                    layer="concept",
                    score=round(min(1.0, max(0.0, norm)), 4),
                    why=why[:240],
                )
            )
            if len(top_nodes) >= top_k:
                break

        surfaced: list[str] = []
        seen: set[str] = set()
        for ep in episodes:
            name = (getattr(ep, "name", "") or "").strip()
            if name.startswith("decision:"):
                did = name.split("decision:", 1)[-1]
                if did and did not in seen:
                    seen.add(did)
                    surfaced.append(did)
        # Edges also carry episode provenance.
        ep_uuids: list[str] = []
        for e in edges[:10]:
            ep_uuids.extend(list(getattr(e, "episodes", None) or [])[:3])
        if ep_uuids and len(surfaced) < 10:
            try:
                from graphiti_core.nodes import EpisodicNode

                client = self._graphiti
                if client is not None:
                    fetched = self._run(
                        EpisodicNode.get_by_uuids(client.driver, ep_uuids[:12]),
                        timeout=4.0,
                    )
                    for ep in fetched or []:
                        name = (getattr(ep, "name", "") or "").strip()
                        if name.startswith("decision:"):
                            did = name.split("decision:", 1)[-1]
                            if did and did not in seen:
                                seen.add(did)
                                surfaced.append(did)
            except Exception:
                _log.debug("graphiti episode provenance lookup failed", exc_info=True)

        facts = [e.fact.strip() for e in edges[:5] if (e.fact or "").strip()]
        notes = ["Graphiti hybrid retrieval (BM25 + embeddings + graph BFS, RRF rerank)."]
        notes.extend(f"fact: {f[:200]}" for f in facts[:3])

        return GraphInfluenceBundle(
            algorithm="graphiti_hybrid_rrf_v1",
            seed_nodes=[],
            top_nodes=top_nodes,
            surfaced_decision_ids=surfaced[:20],
            notes=notes,
        )

    # ---------- observability ----------

    def status(self) -> dict[str, Any]:
        return {
            "backend": "graphiti",
            "initialized": self._initialized,
            "init_error": self._init_error,
            "db_path": self.db_path,
            "ingest_queue_depth": self._ingest_queue.qsize(),
            "ingested_total": len(self._ingested_keys),
            "ingest_done_this_session": self._ingest_done,
            "ingest_errors": self._ingest_errors,
            "last_error": self._last_error,
        }

    def wait_for_ingest_drain(self, timeout: float = 600.0) -> bool:
        """Block until the ingest queue is empty (used by the backfill CLI)."""
        deadline = _utc_now().timestamp() + timeout
        while _utc_now().timestamp() < deadline:
            if self._ingest_queue.unfinished_tasks == 0:
                return True
            threading.Event().wait(0.5)
        return False


_backends: dict[str, GraphitiMemoryBackend] = {}
_backends_lock = threading.Lock()


def get_graphiti_backend(user_id: str, settings: Settings | None = None) -> GraphitiMemoryBackend | None:
    """Singleton-per-user backend, or None when the backend is not usable."""
    s = settings or load_settings()
    mode = (s.graph_backend or "auto").strip().lower()
    if mode == "local":
        return None
    if not graphiti_available(s):
        if mode == "graphiti":
            _log.warning("GRAPH_BACKEND=graphiti but graphiti-core/OPENAI_API_KEY unavailable")
        return None
    key = _sanitize_group(user_id)
    with _backends_lock:
        backend = _backends.get(key)
        if backend is None:
            backend = GraphitiMemoryBackend(user_id, s)
            _backends[key] = backend
        return backend
