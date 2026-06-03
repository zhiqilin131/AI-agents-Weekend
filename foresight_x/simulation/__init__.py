"""Simulation: futures and evaluation."""

from foresight_x.simulation.evaluator import evaluate_options, evaluate_options_from_features
from foresight_x.simulation.feature_audit import build_feature_audit, evaluate_with_audit
from foresight_x.simulation.feature_extractor import extract_features_for_options, extract_option_features
from foresight_x.simulation.feature_merge import ensure_option_tags, grounded_coverage, option_grounded_coverage
from foresight_x.simulation.feature_schemas import (
    CRITICAL_FEATURE_KEYS,
    FeatureAuditBundle,
    FeatureStatus,
    FutureReliabilityReport,
    OptionFeatureVector,
    ScoringClarifyQuestion,
)
from foresight_x.simulation.feature_scorer import score_option_from_features, score_options_from_features
from foresight_x.simulation.future_reliability import assess_future_reliability, assess_futures_reliability
from foresight_x.simulation.future_simulator import simulate_futures
from foresight_x.simulation.missing_field_detector import build_clarify_questions

__all__ = [
    "simulate_futures",
    "evaluate_options",
    "evaluate_options_from_features",
    "extract_option_features",
    "extract_features_for_options",
    "OptionFeatureVector",
    "FutureReliabilityReport",
    "FeatureAuditBundle",
    "FeatureStatus",
    "ScoringClarifyQuestion",
    "CRITICAL_FEATURE_KEYS",
    "score_option_from_features",
    "score_options_from_features",
    "assess_future_reliability",
    "assess_futures_reliability",
    "build_feature_audit",
    "evaluate_with_audit",
    "ensure_option_tags",
    "grounded_coverage",
    "option_grounded_coverage",
    "level_from_clarify_answer",
    "build_clarify_questions",
]
