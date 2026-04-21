"""JSON-backed store for per-user temporal graph memory."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

from foresight_x.config import Settings, load_settings
from foresight_x.memory_graph.models import GraphEdge, GraphNode, GraphSnapshot


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(value: str) -> datetime:
    raw = (value or "").strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _sanitize(user_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", user_id.strip())[:120]


class GraphStore:
    """Persist/load temporal graph snapshot per user."""

    def __init__(self, user_id: str, *, settings: Settings | None = None) -> None:
        self.user_id = user_id
        self.settings = settings or load_settings()
        self.settings.graph_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.settings.graph_dir / f"{_sanitize(user_id)}.json"

    def load(self) -> GraphSnapshot:
        if not self.path.exists():
            return GraphSnapshot(user_id=self.user_id, updated_at=utc_now_iso())
        return GraphSnapshot.model_validate_json(self.path.read_text(encoding="utf-8"))

    def save(self, snapshot: GraphSnapshot) -> None:
        stamped = snapshot.model_copy(update={"updated_at": utc_now_iso()})
        self.path.write_text(stamped.model_dump_json(indent=2), encoding="utf-8")

    def upsert_node(self, snapshot: GraphSnapshot, node: GraphNode) -> None:
        for idx, cur in enumerate(snapshot.nodes):
            if cur.node_id != node.node_id:
                continue
            merged = cur.model_copy(
                update={
                    "node_type": node.node_type or cur.node_type,
                    "label": node.label or cur.label,
                    "metadata": {**cur.metadata, **node.metadata},
                }
            )
            snapshot.nodes[idx] = merged
            return
        snapshot.nodes.append(node)

    def add_bitemporal_edge(self, snapshot: GraphSnapshot, edge: GraphEdge) -> None:
        # Supersede older active edge with same relation identity.
        for idx, cur in enumerate(snapshot.edges):
            if cur.source != edge.source or cur.target != edge.target or cur.edge_type != edge.edge_type:
                continue
            if cur.t_invalid:
                continue
            snapshot.edges[idx] = cur.model_copy(update={"t_invalid": edge.t_valid})
        snapshot.edges.append(edge)

    @staticmethod
    def latest_event_node(snapshot: GraphSnapshot) -> GraphNode | None:
        events = [n for n in snapshot.nodes if n.layer == "event"]
        if not events:
            return None
        return max(events, key=lambda n: parse_iso(n.created_at))
