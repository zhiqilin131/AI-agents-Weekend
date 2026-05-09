"""Per-user decision memory: Chroma + LlamaIndex -> `MemoryBundle`.

**Indexing:** past decisions are inserted when an outcome is recorded via
:func:`foresight_x.harness.improvement_loop.apply_outcome_to_memory` (not at raw
trace save time).

Retrieval uses a **structured embedding query** from
:func:`foresight_x.retrieval.memory_query.build_memory_retrieval_query`, then a
**vector candidate set**, then **re-ranks** by combining: embedding relevance,
**exponential time decay** on ``timestamp``, a **priority overlap** boost from
:func:`profile_snippet_for_retrieval` vs document text, optional **same-domain**
boost when stored ``decision_type`` matches the current ``UserState``, and
packaged-seed downranking. This pattern aligns with hybrid retrieval systems
(RRF-style fusion, temporal decay, multi-signal ranking).
"""

from __future__ import annotations

import json
import logging
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import chromadb
from llama_index.core import Document, StorageContext, VectorStoreIndex
from llama_index.core.base.embeddings.base import BaseEmbedding
from llama_index.vector_stores.chroma import ChromaVectorStore

from foresight_x.config import Settings, load_settings
from foresight_x.retrieval.memory_evidence import expand_selected_memories_to_evidence
from foresight_x.retrieval._embeddings import build_openai_embedding
from foresight_x.retrieval.memory_query import build_memory_retrieval_query
from foresight_x.retrieval.query_text import profile_snippet_for_retrieval
from foresight_x.schemas import (
    DecisionOutcome,
    DecisionTrace,
    MemoryBundle,
    PastDecision,
    UserState,
)

_log = logging.getLogger(__name__)

_RRF_K = 60
_RRF_BLEND = 0.22
_MMR_LAMBDA = 0.75
_MMR_MAX_PER_THEME = 3
_LOW_CONF_TOP_GAP = 0.045
_LOW_CONF_EXPAND_BY = 2


@dataclass
class MemoryCandidate:
    decision_id: str | None
    text: str
    metadata: dict[str, Any]
    similarity_score: float
    fused_score: float
    theme: str
    timestamp: str | None
    outcome_quality: float | None
    source: str = "vector"


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


def _parse_iso_timestamp(raw: str) -> datetime | None:
    if not raw or not str(raw).strip():
        return None
    t = str(raw).strip()
    if t.endswith("Z"):
        t = t[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(t)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _recency_multiplier(ts: str, *, now: datetime | None = None) -> float:
    """Exponential decay by age; missing timestamps get a neutral weight."""
    dt = _parse_iso_timestamp(ts)
    if dt is None:
        return 0.9
    n = now or datetime.now(timezone.utc)
    age_days = max(0.0, (n - dt).total_seconds() / 86400.0)
    # Half-life ~60 days at default decay
    return math.exp(-0.0115 * age_days)


def _priority_word_overlap(profile_snippet: str, doc_text: str) -> float:
    """Cheap alignment signal: shared content words vs profile priorities (0–1)."""
    pw = {w for w in re.findall(r"[a-zA-Z]{4,}", profile_snippet.lower())}
    dw = {w for w in re.findall(r"[a-zA-Z]{4,}", doc_text.lower())}
    if not pw:
        return 0.0
    inter = len(pw & dw)
    return min(1.0, inter / max(6.0, len(pw) * 0.45))


def _is_packaged_seed_meta(md: dict[str, Any]) -> bool:
    """True for demo JSON ingest or legacy ``seed-*`` ids (no re-index required)."""
    v = md.get("packaged_seed")
    if v is True or v == 1 or str(v).lower() in ("true", "1", "yes"):
        return True
    did = str(md.get("decision_id", "") or "")
    return did.startswith("seed-")


def _domain_match_multiplier(user_state: UserState, md: dict[str, Any]) -> float:
    """Soft boost when indexed episode domain matches current decision type (no hard filter)."""
    stored = str(md.get("decision_type", "") or "").strip().lower()
    current = (user_state.decision_type or "").strip().lower()
    if not stored or not current:
        return 1.0
    if stored == current:
        return 1.12
    return 1.0


def _packaged_seed_memory_multiplier(user_state: UserState, md: dict[str, Any]) -> float:
    """Downrank packaged demo memories when the current decision is off-topic."""
    if not _is_packaged_seed_meta(md):
        return 1.0
    dt = (user_state.decision_type or "general").lower()
    if dt in ("career", "academic"):
        return 0.9
    if dt in ("financial", "health"):
        return 0.52
    return 0.28


def _normalize_retriever_score(score: float | None, rank: int) -> float:
    """Map retriever score to (0,1]; handle cosine-like vs distance-like values."""
    if score is None:
        return 1.0 / (rank + 1)
    s = float(score)
    if 0.0 <= s <= 1.0:
        return max(0.04, s)
    if s > 1.0:
        return max(0.04, 1.0 / (1.0 + s))
    return max(0.04, min(1.0, s))


def _node_document_text(node: Any) -> str:
    n = getattr(node, "node", None)
    if n is not None:
        return str(getattr(n, "text", "") or "")
    return str(getattr(node, "text", "") or "")


def _decode_meta(md: dict[str, Any]) -> dict[str, Any]:
    out = dict(md)
    raw = out.get("behavioral_patterns_json")
    if isinstance(raw, str) and raw:
        try:
            out["behavioral_patterns"] = json.loads(raw)
        except json.JSONDecodeError:
            out["behavioral_patterns"] = []
    return out


def _candidate_theme(candidate: MemoryCandidate) -> str:
    """Best-effort theme label from metadata with resilient fallbacks."""
    md = candidate.metadata or {}
    for key in ("decision_type", "decision_domain", "domain", "category"):
        v = str(md.get(key, "") or "").strip().lower()
        if v:
            return v
    for key in ("recurring_themes", "behavioral_patterns"):
        raw = md.get(key)
        if isinstance(raw, list) and raw:
            first = str(raw[0]).strip().lower()
            if first:
                return first
        if isinstance(raw, str) and raw.strip():
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list) and parsed:
                    first = str(parsed[0]).strip().lower()
                    if first:
                        return first
            except json.JSONDecodeError:
                pass
    raw_bp = md.get("behavioral_patterns_json")
    if isinstance(raw_bp, str) and raw_bp.strip():
        try:
            parsed = json.loads(raw_bp)
            if isinstance(parsed, list) and parsed:
                first = str(parsed[0]).strip().lower()
                if first:
                    return first
        except json.JSONDecodeError:
            pass
    return "general"


def _candidate_text_key(text: str) -> str:
    return " ".join((text or "").strip().lower().split())[:4000]


def _dedupe_candidates_by_decision_id(candidates: list[MemoryCandidate]) -> list[MemoryCandidate]:
    """Keep one candidate per decision_id; fallback dedupe by normalized text."""
    best_by_key: dict[str, MemoryCandidate] = {}
    for cand in candidates:
        did = (cand.decision_id or "").strip()
        key = f"did:{did}" if did else f"text:{_candidate_text_key(cand.text)}"
        prev = best_by_key.get(key)
        if prev is None or cand.fused_score > prev.fused_score:
            best_by_key[key] = cand
    out = list(best_by_key.values())
    out.sort(key=lambda x: x.fused_score, reverse=True)
    return out


def _group_candidates_by_theme(candidates: list[MemoryCandidate]) -> dict[str, list[MemoryCandidate]]:
    grouped: dict[str, list[MemoryCandidate]] = {}
    for cand in candidates:
        th = cand.theme or "general"
        grouped.setdefault(th, []).append(cand)
    for th in grouped:
        grouped[th].sort(key=lambda x: x.fused_score, reverse=True)
    return grouped


def _lexical_similarity(a: str, b: str) -> float:
    aw = {w for w in re.findall(r"[a-zA-Z]{3,}", (a or "").lower())}
    bw = {w for w in re.findall(r"[a-zA-Z]{3,}", (b or "").lower())}
    if not aw or not bw:
        return 0.0
    return len(aw & bw) / len(aw | bw)


def _rrf_score(rank_maps: list[dict[str, int]], key: str, *, k: int = _RRF_K) -> float:
    """Reciprocal-rank fusion across rank maps; missing entries contribute 0."""
    total = 0.0
    for rm in rank_maps:
        r = rm.get(key)
        if r is None:
            continue
        total += 1.0 / (k + r)
    return total


def _blend_legacy_with_rrf(
    candidates: list[MemoryCandidate],
    lexical_signal: dict[str, float],
    recency_signal: dict[str, float],
    *,
    rrf_blend: float = _RRF_BLEND,
) -> list[MemoryCandidate]:
    """
    Keep legacy fused score as primary signal, then add a bounded RRF blend.
    This keeps behavior stable while improving cross-signal robustness.
    """
    if not candidates:
        return []
    clamped_blend = max(0.0, min(0.5, rrf_blend))
    key_order = [f"{idx}:{_candidate_text_key(c.text)}:{c.decision_id or ''}" for idx, c in enumerate(candidates)]
    vec_sorted = sorted(
        zip(key_order, candidates),
        key=lambda p: p[1].similarity_score,
        reverse=True,
    )
    lex_sorted = sorted(key_order, key=lambda k: lexical_signal.get(k, 0.0), reverse=True)
    rec_sorted = sorted(key_order, key=lambda k: recency_signal.get(k, 0.0), reverse=True)
    vec_rank = {k: i + 1 for i, (k, _) in enumerate(vec_sorted)}
    lex_rank = {k: i + 1 for i, k in enumerate(lex_sorted)}
    rec_rank = {k: i + 1 for i, k in enumerate(rec_sorted)}
    rank_maps = [vec_rank, lex_rank, rec_rank]
    rrf_vals = {k: _rrf_score(rank_maps, k) for k in key_order}
    max_rrf = max(rrf_vals.values()) if rrf_vals else 1.0
    out: list[MemoryCandidate] = []
    for key, cand in zip(key_order, candidates):
        rrf_norm = (rrf_vals.get(key, 0.0) / max_rrf) if max_rrf > 0 else 0.0
        fused = (1.0 - clamped_blend) * max(0.0, cand.fused_score) + clamped_blend * rrf_norm
        out.append(cand.__class__(**{**cand.__dict__, "fused_score": fused}))
    out.sort(key=lambda x: x.fused_score, reverse=True)
    return out


def _should_expand_low_confidence_selection(selected: list[MemoryCandidate]) -> bool:
    """
    Conservative fallback: when top scores are too flat, keep a few extra rows
    to reduce recall misses in ambiguous queries.
    """
    if len(selected) < 3:
        return False
    s0 = selected[0].fused_score
    s2 = selected[min(2, len(selected) - 1)].fused_score
    return (s0 - s2) < _LOW_CONF_TOP_GAP


def _select_diverse_memory_candidates(
    candidates: list[MemoryCandidate],
    top_k: int,
    lambda_relevance: float = _MMR_LAMBDA,
    max_per_theme: int = _MMR_MAX_PER_THEME,
) -> list[MemoryCandidate]:
    """Select relevant + diverse candidates with theme caps and text-similarity penalty."""
    if top_k <= 0 or not candidates:
        return []
    try:
        ordered = sorted(candidates, key=lambda x: x.fused_score, reverse=True)
        selected: list[MemoryCandidate] = []
        theme_counts: dict[str, int] = {}
        pool = ordered[: min(len(ordered), max(top_k * 6, 18))]
        while pool and len(selected) < top_k:
            best_idx = -1
            best_val = -1.0
            for idx, cand in enumerate(pool):
                th = cand.theme or "general"
                if theme_counts.get(th, 0) >= max_per_theme:
                    continue
                rel = max(0.0, cand.fused_score)
                redundancy = 0.0
                if selected:
                    redundancy = max(_lexical_similarity(cand.text, s.text) for s in selected)
                mmr_val = lambda_relevance * rel - (1.0 - lambda_relevance) * redundancy
                if mmr_val > best_val:
                    best_val = mmr_val
                    best_idx = idx
            if best_idx < 0:
                # Theme caps may be saturated; fill remaining by relevance.
                for cand in pool:
                    if len(selected) >= top_k:
                        break
                    selected.append(cand)
                break
            chosen = pool.pop(best_idx)
            selected.append(chosen)
            th = chosen.theme or "general"
            theme_counts[th] = theme_counts.get(th, 0) + 1
        return selected[:top_k]
    except Exception:
        return sorted(candidates, key=lambda x: x.fused_score, reverse=True)[:top_k]


def summarize_memory_retrieval_quality(
    selected: list[MemoryCandidate],
    candidates: list[MemoryCandidate],
) -> dict[str, Any]:
    theme_set = sorted({(x.theme or "general") for x in selected})
    uniq_ids = {(x.decision_id or "").strip() for x in selected if (x.decision_id or "").strip()}
    if len(selected) <= 1:
        redundancy = 0.0
    else:
        sims: list[float] = []
        for i, lhs in enumerate(selected):
            for rhs in selected[i + 1 :]:
                sims.append(_lexical_similarity(lhs.text, rhs.text))
        redundancy = sum(sims) / len(sims) if sims else 0.0
    avg_fuse = (sum(x.fused_score for x in selected) / len(selected)) if selected else 0.0
    return {
        "candidate_count": len(candidates),
        "selected_count": len(selected),
        "unique_decision_ids": len(uniq_ids),
        "theme_count": len(theme_set),
        "selected_themes": theme_set,
        "redundancy_rate": round(redundancy, 4),
        "avg_fused_score": round(avg_fuse, 6),
    }


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

    def remove_by_decision_id(self, decision_id: str) -> None:
        """Delete indexed chunks for a decision (e.g. before re-indexing with an outcome)."""
        if not decision_id.strip():
            return
        self._collection.delete(where={"decision_id": decision_id})

    def add_past_decision(
        self,
        past: PastDecision,
        *,
        behavioral_patterns: list[str] | None = None,
        packaged_seed: bool = False,
        decision_type: str | None = None,
    ) -> None:
        lines: list[str] = []
        if decision_type and str(decision_type).strip():
            lines.append(f"Decision domain: {str(decision_type).strip()}")
        lines.extend(
            [
                past.situation_summary,
                f"Chosen option: {past.chosen_option}",
            ]
        )
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
        if decision_type and str(decision_type).strip():
            meta["decision_type"] = str(decision_type).strip()
        if behavioral_patterns:
            meta["behavioral_patterns_json"] = json.dumps(behavioral_patterns, ensure_ascii=False)
        if packaged_seed:
            meta["packaged_seed"] = True
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
        self.add_past_decision(
            past,
            behavioral_patterns=patterns or None,
            decision_type=trace.user_state.decision_type or None,
        )

    def list_all_past_decisions(self) -> list[PastDecision]:
        """Return all persisted past decisions for this user, newest first."""
        rows = self._collection.get(include=["metadatas", "documents"])
        metadatas = rows.get("metadatas") or []
        documents = rows.get("documents") or []

        by_decision_id: dict[str, PastDecision] = {}
        for idx, md_raw in enumerate(metadatas):
            md = _decode_meta(dict(md_raw or {}))
            did = str(md.get("decision_id", "") or "").strip()
            if not did:
                continue
            oq = md.get("outcome_quality")
            if isinstance(oq, (int, float)) and int(oq) == -1:
                pq: int | None = None
            elif isinstance(oq, (int, float)):
                pq = int(oq)
            else:
                pq = None

            doc_text = str(documents[idx]) if idx < len(documents) and documents[idx] is not None else ""
            candidate = PastDecision(
                decision_id=did,
                situation_summary=str(md.get("situation_summary", doc_text[:800])),
                chosen_option=str(md.get("chosen_option", "")),
                outcome=str(md.get("outcome")) if md.get("outcome") else None,
                outcome_quality=pq,
                timestamp=str(md.get("timestamp", "")),
            )
            prev = by_decision_id.get(did)
            if prev is None:
                by_decision_id[did] = candidate
                continue
            # Prefer the entry with the newer valid timestamp.
            prev_dt = _parse_iso_timestamp(prev.timestamp) or datetime.min.replace(tzinfo=timezone.utc)
            cand_dt = _parse_iso_timestamp(candidate.timestamp) or datetime.min.replace(tzinfo=timezone.utc)
            if cand_dt >= prev_dt:
                by_decision_id[did] = candidate

        out = list(by_decision_id.values())
        out.sort(
            key=lambda p: _parse_iso_timestamp(p.timestamp) or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        return out

    def retrieve(
        self,
        user_state: UserState,
        top_k: int = 5,
        graph_decision_ids: list[str] | None = None,
        graph_scores: dict[str, float] | None = None,
        fetch_k_override: int | None = None,
    ) -> MemoryBundle:
        extra = profile_snippet_for_retrieval(user_state)
        query = build_memory_retrieval_query(user_state)
        fetch_k = fetch_k_override if fetch_k_override is not None else min(48, max(top_k * 6, top_k + 12))
        retriever = self._index.as_retriever(similarity_top_k=fetch_k)
        raw_nodes = retriever.retrieve(query)

        graph_id_set = {str(x).strip() for x in (graph_decision_ids or []) if str(x).strip()}
        graph_boosts = {str(k).strip(): float(v) for k, v in (graph_scores or {}).items() if str(k).strip()}
        candidates: list[MemoryCandidate] = []
        for rank, node in enumerate(raw_nodes):
            md_raw: dict[str, Any] = {}
            inner = getattr(node, "node", None)
            if inner is not None and getattr(inner, "metadata", None) is not None:
                md_raw = dict(inner.metadata)
            score = getattr(node, "score", None)
            sim = _normalize_retriever_score(score, rank)
            md0 = _decode_meta(md_raw)
            ts = str(md0.get("timestamp", "") or "")
            rec = _recency_multiplier(ts)
            doc_bits = " ".join(
                [
                    _node_document_text(node),
                    str(md0.get("situation_summary", "") or ""),
                    str(md0.get("chosen_option", "") or ""),
                ]
            )
            pov = _priority_word_overlap(extra, doc_bits)
            seed_m = _packaged_seed_memory_multiplier(user_state, md0)
            domain_m = _domain_match_multiplier(user_state, md0)
            did = str(md0.get("decision_id", "") or "").strip()
            graph_m = 1.0
            if did and did in graph_id_set:
                graph_m *= 1.08
            if did and did in graph_boosts:
                graph_m *= 1.0 + max(0.0, min(1.0, graph_boosts[did])) * 0.4
            # Relevance × time decay × (1 + priority alignment) × seed-topic × domain match
            fuse = sim * (0.42 + 0.58 * rec) * (1.0 + 0.38 * pov) * seed_m * domain_m * graph_m
            cand = MemoryCandidate(
                decision_id=did or None,
                text=_node_document_text(node),
                metadata=md0,
                similarity_score=sim,
                fused_score=fuse,
                theme="general",
                timestamp=str(md0.get("timestamp", "") or "") or None,
                outcome_quality=(
                    None
                    if (isinstance(md0.get("outcome_quality"), (int, float)) and int(md0.get("outcome_quality")) == -1)
                    else float(md0.get("outcome_quality"))
                    if isinstance(md0.get("outcome_quality"), (int, float))
                    else None
                ),
            )
            cand.theme = _candidate_theme(cand)
            candidates.append(cand)

        deduped = _dedupe_candidates_by_decision_id(candidates)
        deduped = _dedupe_candidates_by_decision_id(candidates)
        reranked = _blend_legacy_with_rrf(
            deduped,
            {f"{i}:{_candidate_text_key(c.text)}:{c.decision_id or ''}": _priority_word_overlap(extra, c.text) for i, c in enumerate(deduped)},
            {f"{i}:{_candidate_text_key(c.text)}:{c.decision_id or ''}": _recency_multiplier(c.timestamp or "") for i, c in enumerate(deduped)},
        )
        selected = _select_diverse_memory_candidates(reranked, top_k=top_k)
        if _should_expand_low_confidence_selection(reranked[: max(top_k, 3)]):
            selected = _select_diverse_memory_candidates(
                reranked,
                top_k=min(len(reranked), top_k + _LOW_CONF_EXPAND_BY),
            )
        selected_nodes: list[Any] = []
        matched_keys: set[str] = set()
        selected_ids = {x.decision_id for x in selected if x.decision_id}
        selected_text_keys = {_candidate_text_key(x.text) for x in selected if not x.decision_id}
        for node in raw_nodes:
            md_raw: dict[str, Any] = {}
            inner = getattr(node, "node", None)
            if inner is not None and getattr(inner, "metadata", None) is not None:
                md_raw = dict(inner.metadata)
            md0 = _decode_meta(md_raw)
            did = str(md0.get("decision_id", "") or "").strip() or None
            text = _node_document_text(node)
            if did and did in selected_ids:
                key = f"did:{did}"
                if key not in matched_keys:
                    matched_keys.add(key)
                    selected_nodes.append(node)
                continue
            text_key = _candidate_text_key(text)
            if text_key in selected_text_keys:
                key = f"text:{text_key}"
                if key not in matched_keys:
                    matched_keys.add(key)
                    selected_nodes.append(node)

        pasts: list[PastDecision] = []
        patterns_acc: list[str] = []
        outcome_snippets: list[str] = []
        seen_pat: set[str] = set()

        for node in selected_nodes:
            md_raw = {}
            inner = getattr(node, "node", None)
            if inner is not None and getattr(inner, "metadata", None) is not None:
                md_raw = dict(inner.metadata)
            md = _decode_meta(md_raw)
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

            snippet_fallback = _node_document_text(node)[:800]
            pasts.append(
                PastDecision(
                    decision_id=str(did),
                    situation_summary=str(md.get("situation_summary", snippet_fallback)),
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
        selected_themes = [c.theme for c in selected[:8] if c.theme]
        if selected_themes:
            patterns_acc.append("Retrieval themes: " + ", ".join(dict.fromkeys(selected_themes)))
        quality = summarize_memory_retrieval_quality(selected, candidates)
        _log.debug("memory.retrieve quality=%s", quality)
        _log.debug(
            "memory.retrieve selected_decision_ids=%s",
            [c.decision_id for c in selected if c.decision_id],
        )
        evidence_rows = expand_selected_memories_to_evidence(selected, self.settings.traces_dir)
        return MemoryBundle(
            similar_past_decisions=pasts,
            behavioral_patterns=patterns_acc,
            prior_outcomes_summary=summary[:2000],
            memory_evidence=evidence_rows,
        )

    def retrieve_fast(
        self,
        user_state: UserState,
        top_k: int = 3,
        fetch_k: int = 12,
    ) -> MemoryBundle:
        """Fast retrieval for chat turns; keeps same ranking logic with smaller candidate set."""
        return self.retrieve(
            user_state=user_state,
            top_k=max(1, top_k),
            fetch_k_override=max(fetch_k, top_k),
            graph_decision_ids=None,
            graph_scores=None,
        )
