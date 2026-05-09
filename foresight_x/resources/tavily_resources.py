"""Tavily-backed resource discovery — queries only; URLs come from search results."""

from __future__ import annotations

import re
from urllib.parse import urlparse

from foresight_x.retrieval.tavily_client import TavilyGateway, _truncate_tavily_query
from foresight_x.schemas import DecisionTrace, Fact


def _lower(s: str) -> str:
    return (s or "").strip().lower()


def _wants_resources_explicitly(raw: str) -> bool:
    t = _lower(raw)
    keys = (
        "resource",
        "resources",
        "link",
        "links",
        "website",
        "official",
        "application",
        "apply",
        "form",
        "template",
        "tool",
        "doc",
        "requirements",
    )
    return any(k in t for k in keys)


def should_skip_external_resources(trace: DecisionTrace) -> bool:
    """Skip live web resources for purely emotional/private threads unless user asks for links."""
    raw = trace.original_user_input or trace.user_state.raw_input or ""
    t = _lower(raw)
    if _wants_resources_explicitly(raw):
        return False
    emotional = any(
        x in t
        for x in (
            "feel worthless",
            "want to die",
            "suicid",
            "self-harm",
            "panic attack",
            "breakdown",
            "cry every",
            "lonely and",
            "my ex ",
            "they hate me",
            "hurt my feelings",
            "therapy session",
            "therapist says",
        )
    )
    low_action = len(t) < 40 and not any(c.isdigit() for c in t)
    return emotional or (low_action and not any(k in t for k in ("school", "job", "offer", "visa", "apply")))


def _extract_proper_nouns_hint(text: str, *, max_tokens: int = 4) -> str:
    """Very light hint from Title Case runs (school names, products)."""
    hits = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b", text or "")
    seen: list[str] = []
    for h in hits:
        if h in ("I", "We", "My", "The", "If", "When", "Should", "Help"):
            continue
        if h not in seen:
            seen.append(h)
        if len(seen) >= max_tokens:
            break
    return " ".join(seen)


def build_tavily_resource_queries(trace: DecisionTrace, *, max_queries: int = 3) -> list[str]:
    """Build 1–3 precise queries for concrete resources (official sources when applicable)."""
    raw_in = (trace.original_user_input or trace.user_state.raw_input or "").strip()
    raw = _lower(raw_in)
    dt = _lower(trace.user_state.decision_type or "")
    hints = _extract_proper_nouns_hint(raw_in)
    na = trace.recommendation.next_actions[0].action if trace.recommendation.next_actions else ""
    na_l = _lower(na)
    queries: list[str] = []

    def q(x: str) -> None:
        qq = _truncate_tavily_query(x.strip())
        if qq and qq not in queries:
            queries.append(qq)

    # Domain-shaped triggers (avoid vague life-coaching queries)
    if any(k in raw for k in ("transfer", "transferred transferring")):
        base = hints or raw_in[:120]
        q(f"official transfer admissions requirements {base}")
        q("Common App transfer application official")
    if any(k in raw for k in ("intern", "internship", "full-time offer", "job offer", "career")):
        q(f"official career internship recruiting site {hints or raw_in[:100]}")
    if any(k in raw for k in ("cpt", "opt", "f-1", "f1 visa", "stem opt", "work authorization")):
        q("official CPT work authorization F-1 student USCIS")
    if any(k in raw for k in ("ssa", "social security", "ssn")):
        q("official Social Security number application international student")
    if any(k in raw for k in ("notion", "decision matrix", "template")):
        q("decision matrix template planning official Notion")
    if any(k in raw for k in ("google calendar", "ics", "ical")):
        q("Google Calendar import ICS official help")
    if any(k in raw for k in ("software", "tool", "saas", "platform", "api")):
        q(f"official documentation {hints or na[:80]}")
    if "cmu" in raw or "carnegie" in raw:
        q("CMU academic calendar official registrar")
    if dt in ("financial", "health") and any(k in raw for k in ("official", "irs", "fda", "policy")):
        q(f"official government guidance {raw_in[:140]}")

    # Next-action anchored query (last resort)
    if len(queries) < max_queries and na and len(na) > 12:
        if any(k in na_l for k in ("apply", "submit", "register", "schedule", "download", "read")):
            q(f"official {na[:180]}")

    # Generic academic / admissions still concrete
    if len(queries) < max_queries and any(k in raw for k in ("admission", "application deadline", "requirements")):
        q(f"official admissions requirements {hints or raw_in[:100]}")

    return queries[:max_queries]


def _domain_from_url(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
        return host.removeprefix("www.")
    except Exception:
        return ""


_SPAM_HOST_SUBSTR = ("click", "seo-", "-seo", "best10", "top10", "reviewsmania")
_GOOD_HOST_SUFFIX = (".gov", ".edu", ".mil")
_DISALLOWED_BLOG_HOSTS_FOR_SENSITIVE = ("medium.com", "tumblr.com", "blogspot.")


def rank_resource_candidate(
    *,
    fact: Fact,
    query_used: str,
    raw_user: str,
    sensitive_topic: bool,
) -> float:
    """Higher is better."""
    title = (fact.text or "").split("\n", 1)[0][:200]
    url = (fact.source_url or "").strip()
    host = _domain_from_url(url)
    score = 0.35 * float(fact.confidence or 0.75)

    qt = query_used.lower()
    ttl = title.lower()
    for tok in qt.split():
        if len(tok) > 3 and tok in ttl:
            score += 0.12
        if len(tok) > 3 and tok in raw_user.lower():
            score += 0.05

    if any(host.endswith(suf) or suf in host for suf in _GOOD_HOST_SUFFIX):
        score += 0.55
    if "official" in ttl or "registrar" in ttl or "government" in ttl:
        score += 0.25

    low_action = any(x in ttl for x in ("click here", "ultimate guide", "you won't believe"))
    if low_action:
        score -= 0.45

    for bad in _SPAM_HOST_SUBSTR:
        if bad in host:
            score -= 0.55

    if sensitive_topic and any(b in host for b in _DISALLOWED_BLOG_HOSTS_FOR_SENSITIVE):
        score -= 0.65

    return max(0.0, score)


def search_queries_as_ranked_facts(
    gateway: TavilyGateway,
    queries: list[str],
    *,
    raw_user: str,
    sensitive_topic: bool,
    max_keep: int,
) -> list[tuple[float, Fact, str]]:
    """Run Tavily per query; return ranked (score, fact, query)."""
    scored: list[tuple[float, Fact, str]] = []
    seen_urls: set[str] = set()
    domain_hits: dict[str, int] = {}
    for query in queries:
        facts = gateway.search_as_facts(query, max_results=5)
        for f in facts:
            url = (f.source_url or "").strip()
            if not url:
                continue
            if url in seen_urls:
                continue
            dom = _domain_from_url(url)
            dh = domain_hits.get(dom, 0)
            domain_hits[dom] = dh + 1
            dup_pen = 0.22 * dh
            seen_urls.add(url)
            r = rank_resource_candidate(fact=f, query_used=query, raw_user=raw_user, sensitive_topic=sensitive_topic)
            scored.append((r - dup_pen, f, query))
    scored.sort(key=lambda x: -x[0])
    return scored[: max_keep * 4]


def fact_to_search_result_drop(fact: Fact, *, relevance_reason: str, confidence: float, domain: str | None) -> dict:
    title = (fact.text or "").split("\n", 1)[0].strip()[:140]
    body = (fact.text or "").split("\n", 1)[-1].strip()[:220]
    url = (fact.source_url or "").strip() or None
    host = domain or (_domain_from_url(url) if url else None)
    action = "official_page" if host and any(host.endswith(s) for s in (".gov", ".edu")) else "search_result"
    return {
        "id": f"tav_{hash(url or title) & 0xFFFFFFFF:08x}",
        "title": title or "Web result",
        "description": body[:280],
        "url": url,
        "action_type": action,
        "source": "tavily",
        "relevance_reason": relevance_reason[:240],
        "confidence": max(0.0, min(1.0, confidence)),
        "domain": host,
    }
