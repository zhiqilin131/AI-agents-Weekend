"""Temporal graph memory service: ingest events and compute influence.

Backend selection (industrial fallback chain):
1. Graphiti (LLM entity extraction + hybrid semantic retrieval on embedded Kuzu)
   when ``graph_backend`` is "auto"/"graphiti" and graphiti-core + OPENAI_API_KEY
   are available.
2. Legacy local PPR graph (lexical seeding + temporal PageRank) as fallback.

Writes are dual-recorded so the fallback graph stays warm even while Graphiti
is the primary retrieval path.
"""

from __future__ import annotations

import hashlib
import logging

from foresight_x.config import Settings, load_settings
from foresight_x.memory_graph.activation import build_influence_bundle, run_temporal_ppr, seed_vector
from foresight_x.memory_graph.extractor import concept_links_from_user_state, decision_event_node, outcome_event_node
from foresight_x.memory_graph.graphiti_backend import get_graphiti_backend
from foresight_x.memory_graph.models import GraphEdge, GraphNode
from foresight_x.memory_graph.store import GraphStore, utc_now_iso
from foresight_x.schemas import DecisionOutcome, DecisionTrace, GraphInfluenceBundle, UserState

_log = logging.getLogger("foresight_x.memory_graph")


class TemporalGraphMemory:
    """Graph memory with strict fallback semantics (errors are handled by callers)."""

    def __init__(self, user_id: str, *, settings: Settings | None = None) -> None:
        self.settings = settings or load_settings()
        self.user_id = user_id
        self.store = GraphStore(user_id, settings=self.settings)
        try:
            self._graphiti = get_graphiti_backend(user_id, self.settings)
        except Exception:
            _log.debug("graphiti backend unavailable", exc_info=True)
            self._graphiti = None

    def record_decision_trace(self, trace: DecisionTrace) -> None:
        if self._graphiti is not None:
            try:
                self._graphiti.enqueue_decision_trace(trace)
            except Exception:
                _log.debug("graphiti enqueue_decision_trace failed", exc_info=True)
        self._legacy_record_decision_trace(trace)

    def _legacy_record_decision_trace(self, trace: DecisionTrace) -> None:
        snap = self.store.load()
        now = trace.timestamp or utc_now_iso()
        prev = self.store.latest_event_node(snap)
        event_node = decision_event_node(trace)
        self.store.upsert_node(snap, event_node)
        if prev is not None and prev.node_id != event_node.node_id:
            self.store.add_bitemporal_edge(
                snap,
                GraphEdge(
                    source=prev.node_id,
                    target=event_node.node_id,
                    edge_type="temporal_next",
                    weight=0.55,
                    t_valid=now,
                    source_episode=trace.decision_id,
                    confidence=0.9,
                ),
            )

        concept_links = concept_links_from_user_state(trace.user_state)
        for link in concept_links:
            node = GraphNode(
                node_id=link.concept_id,
                layer="concept",
                node_type=link.concept_type,
                label=link.label,
                created_at=now,
                metadata={},
            )
            self.store.upsert_node(snap, node)
            self.store.add_bitemporal_edge(
                snap,
                GraphEdge(
                    source=event_node.node_id,
                    target=node.node_id,
                    edge_type=link.edge_type,
                    weight=link.weight,
                    t_valid=now,
                    source_episode=trace.decision_id,
                    confidence=link.confidence,
                ),
            )
            # Reverse edge improves associative traversal on concept layer.
            self.store.add_bitemporal_edge(
                snap,
                GraphEdge(
                    source=node.node_id,
                    target=event_node.node_id,
                    edge_type="evoked_by_event",
                    weight=max(0.2, min(0.9, link.weight * 0.8)),
                    t_valid=now,
                    source_episode=trace.decision_id,
                    confidence=link.confidence,
                ),
            )

        # Add concept-concept co-activation links (cycles allowed), but avoid dense bridging between
        # profile-memory facts and task-specific concepts, which can create noisy cross-topic activation.
        concepts = [x.concept_id for x in concept_links if x.edge_type != "memory_fact_context"][:12]
        max_pairs = 48
        pair_count = 0
        for i, src in enumerate(concepts):
            for dst in concepts[i + 1 :]:
                if pair_count >= max_pairs:
                    break
                self.store.add_bitemporal_edge(
                    snap,
                    GraphEdge(
                        source=src,
                        target=dst,
                        edge_type="co_activated",
                        weight=0.35,
                        t_valid=now,
                        source_episode=trace.decision_id,
                        confidence=0.65,
                    ),
                )
                self.store.add_bitemporal_edge(
                    snap,
                    GraphEdge(
                        source=dst,
                        target=src,
                        edge_type="co_activated",
                        weight=0.35,
                        t_valid=now,
                        source_episode=trace.decision_id,
                        confidence=0.65,
                    ),
                )
                pair_count += 1
            if pair_count >= max_pairs:
                break
        self.store.save(snap)

    def record_outcome(self, trace: DecisionTrace, outcome: DecisionOutcome) -> None:
        if self._graphiti is not None:
            try:
                self._graphiti.enqueue_outcome(trace, outcome)
            except Exception:
                _log.debug("graphiti enqueue_outcome failed", exc_info=True)
        snap = self.store.load()
        now = outcome.timestamp or utc_now_iso()
        out_node = outcome_event_node(trace, outcome)
        self.store.upsert_node(snap, out_node)
        decision_node_id = f"event:decision:{trace.decision_id}"
        self.store.add_bitemporal_edge(
            snap,
            GraphEdge(
                source=decision_node_id,
                target=out_node.node_id,
                edge_type="led_to_outcome",
                weight=0.9 if outcome.user_reported_quality >= 4 else 0.65,
                t_valid=now,
                source_episode=trace.decision_id,
                confidence=0.95,
            ),
        )
        self.store.add_bitemporal_edge(
            snap,
            GraphEdge(
                source=out_node.node_id,
                target=decision_node_id,
                edge_type="outcome_feedback",
                weight=0.75 if not outcome.reversed_later else 0.5,
                t_valid=now,
                source_episode=trace.decision_id,
                confidence=0.88,
            ),
        )
        self.store.save(snap)

    def record_shadow_event(self, user_text: str, assistant_text: str, *, timestamp: str | None = None) -> None:
        """Store one shadow turn as an event node, linked to extracted concepts."""
        if self._graphiti is not None:
            try:
                self._graphiti.enqueue_shadow_turn(user_text, assistant_text, timestamp=timestamp)
            except Exception:
                _log.debug("graphiti enqueue_shadow_turn failed", exc_info=True)
        ts = (timestamp or "").strip() or utc_now_iso()
        snap = self.store.load()
        digest = hashlib.sha1(f"{user_text}|{assistant_text}|{ts}".encode("utf-8")).hexdigest()[:18]
        sid = f"event:shadow:{digest}"
        node = GraphNode(
            node_id=sid,
            layer="event",
            node_type="shadow",
            label="Shadow chat turn",
            created_at=ts,
            metadata={"user_text": user_text[:400], "assistant_text": assistant_text[:400]},
        )
        self.store.upsert_node(snap, node)
        pseudo_state = UserState(
            raw_input=user_text[:4000],
            active_user_id=self.user_id,
            goals=[],
            time_pressure="medium",
            stress_level=5,
            workload=5,
            current_behavior="shadow_chat",
            decision_type="general",
            reversibility="partial",
        )
        for link in concept_links_from_user_state(pseudo_state):
            cnode = GraphNode(
                node_id=link.concept_id,
                layer="concept",
                node_type=link.concept_type,
                label=link.label,
                created_at=ts,
                metadata={},
            )
            self.store.upsert_node(snap, cnode)
            self.store.add_bitemporal_edge(
                snap,
                GraphEdge(
                    source=sid,
                    target=cnode.node_id,
                    edge_type="shadow_touches",
                    weight=0.6,
                    t_valid=ts,
                    source_episode="shadow",
                    confidence=0.7,
                ),
            )
        self.store.save(snap)

    def record_external_event(self, text: str, *, timestamp: str | None = None, event_type: str = "external_event") -> None:
        """Public hook for external event ingestion (calendar/news/manual entries)."""
        if self._graphiti is not None:
            try:
                self._graphiti.enqueue_external_event(text, timestamp=timestamp, event_type=event_type)
            except Exception:
                _log.debug("graphiti enqueue_external_event failed", exc_info=True)
        ts = (timestamp or "").strip() or utc_now_iso()
        snap = self.store.load()
        digest = hashlib.sha1(f"{text}|{ts}|{event_type}".encode("utf-8")).hexdigest()[:18]
        node_id = f"event:{event_type}:{digest}"
        node = GraphNode(
            node_id=node_id,
            layer="event",
            node_type=event_type,
            label=text[:120] or "External event",
            created_at=ts,
            metadata={"text": text[:2000]},
        )
        self.store.upsert_node(snap, node)
        self.store.save(snap)

    def influence_for(self, user_state: UserState, *, top_k: int = 8, now_iso: str | None = None) -> GraphInfluenceBundle | None:
        if self._graphiti is not None:
            try:
                bundle = self._graphiti.influence_for(user_state, top_k=top_k)
                if bundle is not None and bundle.top_nodes:
                    return bundle
            except Exception:
                _log.debug("graphiti influence_for failed; using legacy PPR", exc_info=True)
        return self._legacy_influence_for(user_state, top_k=top_k, now_iso=now_iso)

    def backend_status(self) -> dict:
        if self._graphiti is not None:
            status = self._graphiti.status()
        else:
            status = {"backend": "local", "initialized": True}
        snap = self.store.load()
        status["legacy_nodes"] = len(snap.nodes)
        status["legacy_edges"] = len(snap.edges)
        return status

    def _legacy_influence_for(self, user_state: UserState, *, top_k: int = 8, now_iso: str | None = None) -> GraphInfluenceBundle | None:
        snap = self.store.load()
        if not snap.nodes or not snap.edges:
            return None
        seeds = seed_vector(user_state, snap)
        if not seeds:
            return None
        now = (now_iso or "").strip() or utc_now_iso()
        ranks = run_temporal_ppr(
            snap,
            seeds,
            iso_now=now,
            damping=self.settings.graph_ppr_damping,
            iterations=self.settings.graph_ppr_iterations,
        )
        if not ranks:
            return None
        return build_influence_bundle(
            snap,
            ranks,
            seeds,
            min_score=self.settings.graph_min_influence_score,
            top_k=top_k,
            query_text=" ".join(
                [
                    user_state.raw_input or "",
                    " ".join(user_state.goals or []),
                    user_state.current_behavior or "",
                    user_state.decision_type or "",
                ]
            ),
        )
