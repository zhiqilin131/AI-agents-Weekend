"""Temporal decay + personalized PageRank activation on graph memory."""

from __future__ import annotations

import math
import re
from collections import defaultdict

from foresight_x.memory_graph.models import GraphSnapshot
from foresight_x.memory_graph.store import parse_iso
from foresight_x.schemas import GraphInfluenceBundle, InfluenceNode, UserState


def _tokens(text: str) -> set[str]:
    raw = {w.lower() for w in re.findall(r"[a-zA-Z][a-zA-Z'-]{2,}", text or "")}
    stop = {"the", "and", "for", "with", "that", "this", "from", "have", "been", "were", "your", "about"}
    return {w for w in raw if w not in stop}


def _age_days(iso_now: str, iso_then: str) -> float:
    n = parse_iso(iso_now)
    t = parse_iso(iso_then)
    delta = (n - t).total_seconds() / 86400.0
    return max(0.0, delta)


def _half_life_days(edge_type: str, source_type: str, target_type: str) -> float:
    t = (edge_type or "").lower()
    if "emotion" in t or source_type == "emotion" or target_type == "emotion":
        return 45.0
    if "belief" in t or source_type == "belief" or target_type == "belief":
        return 180.0
    if "value" in t or source_type == "value" or target_type == "value":
        return 720.0
    if "person" in t or source_type == "person" or target_type == "person":
        return 240.0
    return 120.0


def _edge_effective_weight(
    base_weight: float,
    age_days: float,
    *,
    half_life_days: float,
) -> float:
    if half_life_days <= 0:
        return base_weight
    # Logarithmic temporal decay: slower long-tail forgetting than exponential.
    # multiplier = 1 / (1 + log(1 + age / scale))
    scale = max(1.0, half_life_days / 2.0)
    decay = 1.0 / (1.0 + math.log1p(age_days / scale))
    return max(0.0, base_weight * decay)


def seed_vector(user_state: UserState, snapshot: GraphSnapshot) -> dict[str, float]:
    q_tokens = _tokens(
        " ".join(
            [
                user_state.raw_input,
                " ".join(user_state.goals),
                user_state.current_behavior,
                user_state.decision_type,
            ]
        )
    )
    if not q_tokens:
        return {}
    seeds: dict[str, float] = {}
    for node in snapshot.nodes:
        md_bits = " ".join(str(v) for v in (node.metadata or {}).values())
        n_tokens = _tokens(node.label + " " + md_bits)
        inter = len(q_tokens & n_tokens)
        if inter <= 0:
            continue
        score = inter / max(2.0, len(n_tokens) * 0.7)
        if score >= 0.08:
            seeds[node.node_id] = max(seeds.get(node.node_id, 0.0), score)
    # normalize to probability vector
    total = sum(seeds.values())
    if total <= 0:
        return {}
    return {k: v / total for k, v in seeds.items()}


def run_temporal_ppr(
    snapshot: GraphSnapshot,
    seeds: dict[str, float],
    *,
    iso_now: str,
    damping: float,
    iterations: int,
) -> dict[str, float]:
    if not seeds:
        return {}
    node_ids = [n.node_id for n in snapshot.nodes]
    node_set = set(node_ids)
    if not node_ids:
        return {}
    node_type = {n.node_id: n.node_type for n in snapshot.nodes}

    outgoing: dict[str, dict[str, float]] = defaultdict(dict)
    for edge in snapshot.edges:
        if edge.source not in node_set or edge.target not in node_set:
            continue
        if edge.t_invalid and parse_iso(edge.t_invalid) <= parse_iso(iso_now):
            continue
        half_life = _half_life_days(edge.edge_type, node_type.get(edge.source, ""), node_type.get(edge.target, ""))
        age = _age_days(iso_now, edge.t_valid)
        w = _edge_effective_weight(float(edge.weight), age, half_life_days=half_life)
        if w <= 1e-8:
            continue
        outgoing[edge.source][edge.target] = outgoing[edge.source].get(edge.target, 0.0) + w

    # row-normalize transition matrix lazily
    transition: dict[str, dict[str, float]] = {}
    for src, tgts in outgoing.items():
        z = sum(tgts.values())
        if z <= 0:
            continue
        transition[src] = {t: w / z for t, w in tgts.items()}

    ranks = {nid: seeds.get(nid, 0.0) for nid in node_ids}
    teleport = {nid: seeds.get(nid, 0.0) for nid in node_ids}

    for _ in range(max(1, iterations)):
        nxt = {nid: (1.0 - damping) * teleport.get(nid, 0.0) for nid in node_ids}
        for src, probs in transition.items():
            src_mass = ranks.get(src, 0.0)
            if src_mass <= 0:
                continue
            for dst, p in probs.items():
                nxt[dst] = nxt.get(dst, 0.0) + damping * src_mass * p
        ranks = nxt

    total = sum(ranks.values())
    if total <= 0:
        return {}
    return {k: v / total for k, v in ranks.items()}


def build_influence_bundle(
    snapshot: GraphSnapshot,
    ranks: dict[str, float],
    seeds: dict[str, float],
    *,
    min_score: float,
    top_k: int,
) -> GraphInfluenceBundle:
    by_id = {n.node_id: n for n in snapshot.nodes}
    blended: dict[str, float] = {}
    for node_id, r in ranks.items():
        s = seeds.get(node_id, 0.0)
        # Blend graph centrality with direct query match so surfaced nodes stay relevant to this run.
        blended[node_id] = 0.68 * r + 0.32 * s
    ordered = sorted(blended.items(), key=lambda x: x[1], reverse=True)
    top_nodes: list[InfluenceNode] = []
    surfaced_decision_ids: list[str] = []
    seen_decisions: set[str] = set()
    for node_id, score in ordered:
        if score < min_score:
            continue
        node = by_id.get(node_id)
        if node is None:
            continue
        why = "High activation from query-linked nodes via time-decayed relations."
        if node_id in seeds:
            why = "Directly matched current query seed concepts."
        top_nodes.append(
            InfluenceNode(
                node_id=node.node_id,
                label=node.label,
                node_type=node.node_type,
                layer=node.layer,
                score=round(score, 6),
                why=why,
            )
        )
        did = str(node.metadata.get("decision_id", "")).strip()
        if did and did not in seen_decisions:
            seen_decisions.add(did)
            surfaced_decision_ids.append(did)
        if node.node_id.startswith("event:decision:"):
            did2 = node.node_id.split("event:decision:", 1)[-1]
            if did2 and did2 not in seen_decisions:
                seen_decisions.add(did2)
                surfaced_decision_ids.append(did2)
        if len(top_nodes) >= top_k:
            break
    notes = [
        "Temporal graph retrieval is additive; vector retrieval remains the fallback baseline.",
        "Scores are relative activation mass from personalized PageRank with logarithmic time decay.",
    ]
    return GraphInfluenceBundle(
        algorithm="ppr_log_decay_v1",
        seed_nodes=list(seeds.keys())[:20],
        top_nodes=top_nodes,
        surfaced_decision_ids=surfaced_decision_ids[:20],
        notes=notes,
    )
