## Inspiration

As college students, we make consequential decisions constantly—courses, internships, leases, hard conversations—often under deadline pressure and incomplete information. Generic chatbots fell short in two ways: **decisions were not treated as decisions** (no options, tradeoffs, simulated futures, or a clear recommendation), and **memory was too shallow** (every session starts from zero).

We built **Foresight-X** to remember your decision history, ground advice in outside evidence, and deliver **traceable recommendations**, not vibes. We entered the **Resilience track** because a decision agent that only works when every API is healthy is a liability—we prove it can **finish under failure**, on a dedicated Resilience page judges can explore.

---

## What it does

Foresight-X is an evidence-grounded decision system for students and early-career professionals—not a chatbot. Every serious question runs: **perceive → retrieve → infer → simulate → decide → reflect**.

The system structures your situation (with clarification when needed), pulls **your past** and **world evidence** in parallel, checks bias, generates a few real options, simulates best / expected / worst paths, scores tradeoffs, and recommends with inspectable reasoning. You get a **Decision Report**—seven sections, recommendation first, a short **Mochi** summary, visible grounding (memory vs. evidence vs. assumption), and next actions, plus follow-up on a single option. Outcomes feed a **harness loop** so later similar decisions can change.

**Four entry points:** **Home** for a full report on one screen; **Shadow Chat** to process half-formed thoughts and escalate to a report (clarify → offer → optional role-play; manual Decision Mode with confirm-before-generate; multiple decisions per thread); **Slime Buddy** for voice-first access, memory, and calendar drafts; **Execution planner** to turn actions into calendar blocks you approve—nothing auto-books. Also: onboarding, profile & memory, diary, history, optional login.

**Trust:** disclaimers on sensitive topics, ~20 safety eval scenarios, grounding strength labels (strong / mixed / thin).

**Resilience (for judges):** open **Resilience Report** from Home—architecture map under fault scenarios, PASS/FAIL chaos timeline, one-click isolated smoke test (no user data touched), SLO snapshot (no hard crashes on decision paths; honest degraded-mode copy). Everyday use matches that: retries, failover, circuit breakers, stage fallbacks, visible warnings.

---

## How we built it

Python backend with streaming chat and reports, strict trace schemas, vector memory, optional live web search. React frontend with real-time UI, 3D slime, resilience explorer. Automated tests, ~20 eval scenarios, scripted chaos artifacts. Modular stages so resilience and eval attach to the real pipeline—not a demo shell.

---

## Challenges

Early reports were too long—we went recommendation-first with a short voice summary. Users confused memory and web evidence until we labeled grounding. Calendar actions duplicated until we deduped and required confirmation. Slime needed voice without silent side effects. Clarification sometimes blocked momentum—skip flows and manual Decision Mode helped. Live API failures forced separating recovered retries from true degradation and making chaos reproducible for judging. Memory had to persist across deploys. We shipped core pipeline + outcome loop first, resilience judge UX in parallel. Shadow polish (second decisions, confirm-before-report, readable titles) was product alignment, not one bug.

---

## Accomplishments

Full decision pipeline with options, simulation, and inspectable traces—not a chat wrapper. One memory core, four interfaces. Grounding strength and per-option depth. Outcome loop that can change the next recommendation. Live web plus personal history in one answer. Under injected faults, decision paths still complete; judges get explorer, evidence, smoke test, report card. Demo polish: Mochi, onboarding, planner handoff, manual Decision Mode, summarized titles.

We met our bar: seven-section report in one run, web and memory in the trace, a second run after an outcome that observably differs. Resilience: no hard crash when providers fail (P0), honest degradation when they do (P1), chaos legs pass with streaming complete and degradations logged.

---

## What we learned

- **Decision quality is systems design**, not a better prompt alone.
- **People need two speeds**—processing (Shadow) and committing (report + planner); handoffs must be obvious.
- **Memory should be curated** (decisions and profile facts), not raw chat dumps.
- **Trust is UI**—show why, not only what.
- **Test outcomes and outages early**—eval scenarios and chaos runs saved our demo.
- **Resilience is product**, not a footnote: students deserve honesty when the stack struggles.
- **Voice needs guardrails** as much as charm.
- **Scope discipline** beats feature sprawl in a hackathon.

---

## What's next

Domain-tuned slime modes; decision-quality metrics beyond uptime; smoother handoffs; priorities wired into every retrieval step; student pilots. Resilience: chaos in CI and one dashboard tying eval and degradation.

**Try it:** Home → decision · Chat → talk it through · Buddy → voice · Resilience Report → faults and smoke test.
