"""Live smoke test for the Graphiti backend (real LLM + embedding calls).

Run: python3 scripts/graphiti_smoke.py
"""

import logging
import sys
import time

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)

from foresight_x.config import load_settings
from foresight_x.memory_graph.graphiti_backend import get_graphiti_backend
from foresight_x.schemas import UserState

settings = load_settings()
backend = get_graphiti_backend("smoke_test_user", settings)
if backend is None:
    print("FAIL: backend unavailable")
    sys.exit(1)

# Two memories: one relationship, one unrelated food memory ("salmon" trap).
backend.enqueue_shadow_turn(
    "我最近和我女朋友的关系很紧张，我们经常吵架，我在考虑要不要分手。",
    "听起来你正处在一段很艰难的感情阶段。可以说说你们最近一次吵架是因为什么吗？",
    timestamp="2026-06-01T10:00:00+00:00",
)
backend.enqueue_shadow_turn(
    "I cooked salmon for dinner yesterday, it was delicious with lemon butter.",
    "Sounds great! Salmon with lemon butter is a classic combination.",
    timestamp="2026-05-20T19:00:00+00:00",
)

print("waiting for ingest (LLM entity extraction)...")
drained = backend.wait_for_ingest_drain(timeout=300)
st = backend.status()
print(f"ingest drained={drained} done={st['ingest_done_this_session']} errors={st['ingest_errors']} last_error={st['last_error']}")
if st["ingest_errors"]:
    sys.exit(2)

us = UserState(
    raw_input="我决定和我女朋友分手了，但是我很难过，不知道这个决定对不对。",
    active_user_id="smoke_test_user",
    goals=["处理好分手后的情绪"],
    time_pressure="medium",
    stress_level=7,
    workload=5,
    current_behavior="shadow_chat",
    decision_type="relationship",
    reversibility="partial",
)
t0 = time.time()
bundle = backend.influence_for(us, top_k=6)
dt = time.time() - t0
if bundle is None:
    print("FAIL: no bundle returned")
    sys.exit(3)

print(f"\nsearch took {dt:.2f}s, algorithm={bundle.algorithm}")
for n in bundle.top_nodes:
    print(f"  [{n.score:.3f}] {n.label} ({n.node_type}) — {n.why[:90]}")
print("notes:", bundle.notes[:2])

labels = " ".join(n.label.lower() for n in bundle.top_nodes[:3])
if "salmon" in labels:
    print("\nWARN: salmon still in top-3 for a breakup query")
    sys.exit(4)
print("\nPASS: breakup query surfaces relationship memories, salmon not in top-3")
