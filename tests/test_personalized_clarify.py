"""Tests for personalized clarification scoring, context, and persistence classification."""

from __future__ import annotations

from foresight_x.perception.clarify_types import ClarifyOption
from foresight_x.perception.personalized_clarify import (
    PersonalizedCandidate,
    build_clarification_context,
    classify_clarification_persistence,
    final_candidate_score,
    generic_checklist_penalty,
    heuristic_domain,
    heuristic_sensitivity_risk,
    repetition_penalty,
    run_personalized_clarify_gate,
    should_skip_clarification_for_shadow_chat,
)
from foresight_x.schemas import MemoryFactCategory, ProfileMemoryFact, UserProfile


def test_transfer_school_heuristic_domain_academic() -> None:
    msg = "Should I transfer schools?"
    assert heuristic_domain(msg) == "academic"


def test_transfer_query_budget_penalized_in_scoring() -> None:
    c = PersonalizedCandidate(
        question="What is your budget and how urgent is this?",
        target_dimension="money",
        options=[
            ClarifyOption(value="a", label="Low"),
            ClarifyOption(value="b", label="High"),
        ],
        domain_relevance=0.9,
        uncertainty_reduction=0.8,
        decision_impact=0.7,
        personalization_value=0.5,
        user_friction=0.2,
        sensitivity_risk=0.1,
        why_this_question="",
    )
    score_generic = final_candidate_score(
        c,
        domain="academic",
        thread_events=[],
        profile_blob="",
    )
    c_good = c.model_copy(
        update={
            "question": "Is your main reason academic fit, social environment, career opportunity, or emotional wellbeing?",
            "target_dimension": "transfer_primary_motive",
        }
    )
    score_good = final_candidate_score(
        c_good,
        domain="academic",
        thread_events=[],
        profile_blob="",
    )
    assert score_good > score_generic
    assert generic_checklist_penalty(c.question, "academic") > 0.5


def test_career_decision_value_clarification_scores_higher_than_pure_budget() -> None:
    c_budget = PersonalizedCandidate(
        question="What is your internship budget?",
        target_dimension="budget",
        options=[ClarifyOption(value="x", label="Tight"), ClarifyOption(value="y", label="Flexible")],
        domain_relevance=0.5,
        uncertainty_reduction=0.4,
        decision_impact=0.3,
        personalization_value=0.2,
        user_friction=0.2,
        sensitivity_risk=0.05,
        why_this_question="",
    )
    c_value = PersonalizedCandidate(
        question="Would you rather optimize for learning upside, brand prestige, compensation, or lower stress?",
        target_dimension="summer_objective",
        options=[
            ClarifyOption(value="learn", label="Learning upside"),
            ClarifyOption(value="brand", label="Brand / prestige"),
        ],
        domain_relevance=0.95,
        uncertainty_reduction=0.85,
        decision_impact=0.8,
        personalization_value=0.7,
        user_friction=0.25,
        sensitivity_risk=0.05,
        why_this_question="",
    )
    s_budget = final_candidate_score(c_budget, domain="career", thread_events=[], profile_blob="")
    s_value = final_candidate_score(c_value, domain="career", thread_events=[], profile_blob="")
    assert s_value > s_budget


def test_social_issue_framing_not_budget() -> None:
    assert generic_checklist_penalty("What is your budget for this conversation?", "social_issue") > 0.5


def test_sensitive_stereotype_heuristic_high_risk() -> None:
    q = "What do you think Black people are like in general?"
    assert heuristic_sensitivity_risk(q) >= 0.85


def test_skipped_dimension_gets_repetition_penalty() -> None:
    c = PersonalizedCandidate(
        question="What matters more: workload or prestige?",
        target_dimension="workload_vs_prestige",
        options=[ClarifyOption(value="a", label="Workload"), ClarifyOption(value="b", label="Prestige")],
        domain_relevance=0.9,
        uncertainty_reduction=0.8,
        decision_impact=0.7,
        personalization_value=0.6,
        user_friction=0.2,
        sensitivity_risk=0.05,
        why_this_question="",
    )
    events = [{"kind": "skipped", "target_dimension": "workload_vs_prestige", "question_prompt": "…", "answer_label": ""}]
    assert repetition_penalty(c, thread_events=events, profile_blob="") >= 0.9


def test_recently_answered_dimension_gets_repetition_penalty() -> None:
    c = PersonalizedCandidate(
        question="What matters more: workload or prestige?",
        target_dimension="workload_vs_prestige",
        options=[ClarifyOption(value="a", label="Workload"), ClarifyOption(value="b", label="Prestige")],
        domain_relevance=0.9,
        uncertainty_reduction=0.8,
        decision_impact=0.7,
        personalization_value=0.6,
        user_friction=0.2,
        sensitivity_risk=0.05,
        why_this_question="",
    )
    events = [{"kind": "answered", "target_dimension": "workload_vs_prestige", "question_prompt": "", "answer_label": "Workload"}]
    assert repetition_penalty(c, thread_events=events, profile_blob="") >= 0.9


def test_profile_blob_reduces_repeat_dimension() -> None:
    c = PersonalizedCandidate(
        question="How grade-sensitive are you for this term?",
        target_dimension="grade_sensitivity",
        options=[ClarifyOption(value="a", label="Very"), ClarifyOption(value="b", label="Not much")],
        domain_relevance=0.9,
        uncertainty_reduction=0.8,
        decision_impact=0.7,
        personalization_value=0.6,
        user_friction=0.2,
        sensitivity_risk=0.05,
        why_this_question="",
    )
    blob = "grade sensitivity user is very grade sensitive memory"
    assert repetition_penalty(c, thread_events=[], profile_blob=blob) >= 0.3


def test_should_ask_false_clear_message_override() -> None:
    class _Llm:
        def structured_predict(self, output_cls, prompt, **kwargs):
            return output_cls(
                domain="academic",
                user_intent="transfer",
                known_about_user=[],
                missing_dimensions=[],
                candidate_questions=[
                    PersonalizedCandidate(
                        question="dummy?",
                        target_dimension="x",
                        options=[
                            ClarifyOption(value="1", label="A"),
                            ClarifyOption(value="2", label="B"),
                        ],
                        domain_relevance=0.5,
                        uncertainty_reduction=0.5,
                        decision_impact=0.5,
                        personalization_value=0.5,
                        user_friction=0.2,
                        sensitivity_risk=0.1,
                        why_this_question="",
                    )
                ],
                selected_question="dummy?",
                should_ask=True,
            )

    long_msg = (
        "Should I transfer schools? I care most about research fit and advisor quality; "
        "I am okay moving cities; money is tight but manageable; timeline is next fall application cycle."
    ) * 2
    r = run_personalized_clarify_gate(long_msg, _Llm(), profile=UserProfile())
    assert r.need_clarification is False
    assert r.skip_reason == "not_needed"


def test_classify_task_specific_deadline_phrase() -> None:
    plan = classify_clarification_persistence(
        user_message="Help me decide",
        answers={"deadline": "For this decision, deadline is Friday"},
        llm=None,
    )
    assert plan.items[0].persistence == "task_specific"


def test_classify_durable_general_preference_rule() -> None:
    plan = classify_clarification_persistence(
        user_message="Career",
        answers={"risk": "I generally prefer learning upside over prestige"},
        llm=None,
    )
    assert plan.items[0].persistence == "durable_profile"


def test_build_clarification_context_filters_memory() -> None:
    prof = UserProfile(
        memory_facts=[
            ProfileMemoryFact(
                id="1",
                category=MemoryFactCategory.GOALS,
                text="User prefers small classes over large lectures",
                source="shadow",
                created_at="",
            )
        ]
    )
    ctx = build_clarification_context(
        "Should I pick the seminar or the big lecture?",
        [{"role": "user", "content": "I hate huge classes"}],
        prof,
        retrieved_memory_lines=["(memory) User prefers small classes over large lectures"],
        thread_clarification_events=[],
    )
    assert "seminar" in ctx.user_message.lower() or "lecture" in ctx.user_message.lower()
    assert ctx.profile_fact_lines


def test_should_skip_clarification_shadow_chat_joke_framing() -> None:
    assert should_skip_clarification_for_shadow_chat("Here is a joke, I eat shit")
    assert should_skip_clarification_for_shadow_chat("开玩笑而已")


def test_should_not_skip_when_user_insists_serious() -> None:
    assert not should_skip_clarification_for_shadow_chat("Not a joke — should I quit my job?")


def test_shadow_chat_purpose_skips_gate_before_llm() -> None:
    r = run_personalized_clarify_gate(
        "Here is a joke, I eat shit",
        None,
        interaction_purpose="shadow_chat",
    )
    assert not r.need_clarification
    assert r.skip_reason == "shadow_chat_non_analytical"


def test_decision_flow_still_hits_no_llm_not_shadow_skip() -> None:
    r = run_personalized_clarify_gate(
        "Here is a joke, I eat shit",
        None,
        interaction_purpose=None,
    )
    assert r.skip_reason == "no_llm"
