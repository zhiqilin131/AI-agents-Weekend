"""Runtime configuration from environment."""

from __future__ import annotations

from pathlib import Path
from typing import Self

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _strip_outer_quotes_str(v: object) -> str:
    """Railway and some UIs persist values wrapped in ASCII quotes — strip one matching pair."""
    if v is None:
        return ""
    s = str(v).strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1].strip()
    return s


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # Allow ``Settings(chroma_persist_dir=..., foresight_data_dir=...)``; without this,
        # validation_alias-only fields ignore constructor kwargs and fall back to .env/defaults.
        populate_by_name=True,
        # Credit multiplier fields use ``model_*`` names; exclude default ``model_`` protected namespace.
        protected_namespaces=(),
    )

    tavily_api_key: str = Field(default="", validation_alias=AliasChoices("tavily_api_key", "TAVILY_API_KEY"))
    tavily_search_depth: str = Field(
        default="advanced",
        validation_alias=AliasChoices("tavily_search_depth", "TAVILY_SEARCH_DEPTH"),
    )
    #: Call Tavily on every run (when API key is set), not only when the cache is sparse.
    tavily_always: bool = Field(default=False, validation_alias=AliasChoices("tavily_always", "TAVILY_ALWAYS"))
    #: When True (default), always run a fresh Tavily search for this decision instead of skipping because
    #: Chroma already has enough unrelated cached chunks (avoids stale academic/demo baselines).
    tavily_fresh_each_run: bool = Field(
        default=True,
        validation_alias=AliasChoices("tavily_fresh_each_run", "TAVILY_FRESH_EACH_RUN"),
    )
    #: If local Chroma has fewer than this many hits, run Tavily (unless ``tavily_always`` / ``tavily_fresh_each_run``).
    tavily_min_cache_hits: int = Field(default=3, ge=0, validation_alias=AliasChoices("tavily_min_cache_hits", "TAVILY_MIN_CACHE_HITS"))

    chroma_persist_dir: Path = Field(
        default=Path("./data/chroma"),
        validation_alias=AliasChoices("chroma_persist_dir", "CHROMA_PERSIST_DIR"),
    )

    foresight_user_id: str = Field(default="demo_user", validation_alias=AliasChoices("foresight_user_id", "FORESIGHT_USER_ID"))
    foresight_data_dir: Path = Field(
        default=Path("./data"),
        validation_alias=AliasChoices("foresight_data_dir", "FORESIGHT_DATA_DIR"),
    )

    # LlamaIndex uses OpenAI-compatible APIs for chat + embeddings (RAG still uses LlamaIndex + Chroma).
    openai_api_key: str = Field(default="", validation_alias=AliasChoices("openai_api_key", "OPENAI_API_KEY"))
    openai_model: str = Field(default="gpt-4o-mini", validation_alias=AliasChoices("openai_model", "OPENAI_MODEL"))
    openai_embedding_model: str = Field(
        default="text-embedding-3-small",
        validation_alias=AliasChoices("openai_embedding_model", "OPENAI_EMBEDDING_MODEL"),
    )
    openai_api_base: str | None = Field(default=None, validation_alias=AliasChoices("openai_api_base", "OPENAI_API_BASE"))
    openai_tts_model: str = Field(
        default="tts-1",
        validation_alias=AliasChoices("openai_tts_model", "OPENAI_TTS_MODEL"),
    )
    openai_tts_voice: str = Field(
        default="onyx",
        validation_alias=AliasChoices("openai_tts_voice", "OPENAI_TTS_VOICE"),
    )
    openai_tts_instructions: str = Field(
        default=(
            "Speak like a tiny friendly slime companion: warm, cute, lightly bouncy, curious, "
            "and emotionally expressive, but still clear and not childish."
        ),
        validation_alias=AliasChoices("openai_tts_instructions", "OPENAI_TTS_INSTRUCTIONS"),
    )
    #: GPT-5 / reasoning models use OpenAI ``/v1/responses`` via LlamaIndex ``OpenAIResponses`` (see ``llm_factory``).
    openai_responses_reasoning_effort: str = Field(
        default="low",
        validation_alias=AliasChoices(
            "openai_responses_reasoning_effort",
            "OPENAI_RESPONSES_REASONING_EFFORT",
        ),
    )
    openai_responses_max_output_tokens: int | None = Field(
        default=16384,
        ge=256,
        le=200_000,
        validation_alias=AliasChoices(
            "openai_responses_max_output_tokens",
            "OPENAI_RESPONSES_MAX_OUTPUT_TOKENS",
        ),
    )
    openai_responses_context_window: int | None = Field(
        default=1_048_576,
        ge=4096,
        le=2_000_000,
        validation_alias=AliasChoices(
            "openai_responses_context_window",
            "OPENAI_RESPONSES_CONTEXT_WINDOW",
        ),
    )
    #: Client timeout for provider requests made through LlamaIndex OpenAI wrappers.
    openai_request_timeout_sec: float = Field(
        default=30.0,
        ge=1.0,
        le=180.0,
        validation_alias=AliasChoices("openai_request_timeout_sec", "OPENAI_REQUEST_TIMEOUT_SEC"),
    )
    fx_llm_primary: str = Field(
        default="",
        validation_alias=AliasChoices("fx_llm_primary", "FX_LLM_PRIMARY"),
    )
    fx_llm_fallback: str = Field(
        default="",
        validation_alias=AliasChoices("fx_llm_fallback", "FX_LLM_FALLBACK"),
    )
    fx_llm_failover_order: str = Field(
        default="",
        validation_alias=AliasChoices("fx_llm_failover_order", "FX_LLM_FAILOVER_ORDER"),
    )
    fx_llm_request_timeout_s: float = Field(
        default=20.0,
        ge=1.0,
        le=180.0,
        validation_alias=AliasChoices("fx_llm_request_timeout_s", "FX_LLM_REQUEST_TIMEOUT_S"),
    )
    fx_llm_max_retries: int = Field(
        default=3,
        ge=1,
        le=8,
        validation_alias=AliasChoices("fx_llm_max_retries", "FX_LLM_MAX_RETRIES"),
    )
    #: Optional secondary OpenAI-compatible model for failover when primary repeatedly fails.
    resilience_secondary_openai_model: str = Field(
        default="",
        validation_alias=AliasChoices(
            "resilience_secondary_openai_model",
            "RESILIENCE_SECONDARY_OPENAI_MODEL",
        ),
    )
    resilience_secondary_openai_api_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "resilience_secondary_openai_api_key",
            "RESILIENCE_SECONDARY_OPENAI_API_KEY",
        ),
    )
    resilience_secondary_openai_api_base: str = Field(
        default="",
        validation_alias=AliasChoices(
            "resilience_secondary_openai_api_base",
            "RESILIENCE_SECONDARY_OPENAI_API_BASE",
        ),
    )
    #: Generic retry attempts for transient provider faults.
    resilience_retry_attempts: int = Field(
        default=2,
        ge=1,
        le=6,
        validation_alias=AliasChoices("resilience_retry_attempts", "RESILIENCE_RETRY_ATTEMPTS"),
    )
    resilience_retry_backoff_ms: int = Field(
        default=250,
        ge=0,
        le=5000,
        validation_alias=AliasChoices("resilience_retry_backoff_ms", "RESILIENCE_RETRY_BACKOFF_MS"),
    )
    resilience_circuit_failure_threshold: int = Field(
        default=3,
        ge=1,
        le=20,
        validation_alias=AliasChoices(
            "resilience_circuit_failure_threshold",
            "RESILIENCE_CIRCUIT_FAILURE_THRESHOLD",
        ),
    )
    resilience_circuit_open_sec: float = Field(
        default=30.0,
        ge=1.0,
        le=600.0,
        validation_alias=AliasChoices("resilience_circuit_open_sec", "RESILIENCE_CIRCUIT_OPEN_SEC"),
    )
    resilience_brownout_latency_ms: int = Field(
        default=9000,
        ge=500,
        le=120000,
        validation_alias=AliasChoices("resilience_brownout_latency_ms", "RESILIENCE_BROWNOUT_LATENCY_MS"),
    )
    retrieve_parallel_timeout_sec: float = Field(
        default=18.0,
        ge=2.0,
        le=120.0,
        validation_alias=AliasChoices("retrieve_parallel_timeout_sec", "RETRIEVE_PARALLEL_TIMEOUT_SEC"),
    )
    #: Timeout for atomic-claim extraction in shadow turn; on timeout, continue without claims.
    shadow_atomic_claims_timeout_sec: float = Field(
        default=1.2,
        ge=0.1,
        le=15.0,
        validation_alias=AliasChoices("shadow_atomic_claims_timeout_sec", "SHADOW_ATOMIC_CLAIMS_TIMEOUT_SEC"),
    )
    #: Minimum lexical overlap ratio required to reuse chat-fast memory cache.
    memory_cache_min_topic_overlap: float = Field(
        default=0.25,
        ge=0.0,
        le=1.0,
        validation_alias=AliasChoices("memory_cache_min_topic_overlap", "MEMORY_CACHE_MIN_TOPIC_OVERLAP"),
    )
    #: Max routing latency budget for Slime voice command router before graceful fallback.
    slime_voice_route_timeout_ms: int = Field(
        default=1200,
        ge=100,
        le=20000,
        validation_alias=AliasChoices("slime_voice_route_timeout_ms", "SLIME_VOICE_ROUTE_TIMEOUT_MS"),
    )
    #: Max tool execution budget for Slime voice before fallback response.
    slime_voice_tool_timeout_ms: int = Field(
        default=2200,
        ge=100,
        le=60000,
        validation_alias=AliasChoices("slime_voice_tool_timeout_ms", "SLIME_VOICE_TOOL_TIMEOUT_MS"),
    )
    #: Run Slime voice post-processing (memory capture/summary) in background.
    slime_voice_tool_postprocess_async: bool = Field(
        default=True,
        validation_alias=AliasChoices("slime_voice_tool_postprocess_async", "SLIME_VOICE_TOOL_POSTPROCESS_ASYNC"),
    )
    #: If async post-processing is enabled, wait this long for quick completion before returning.
    slime_voice_tool_postprocess_wait_ms: int = Field(
        default=180,
        ge=0,
        le=10000,
        validation_alias=AliasChoices("slime_voice_tool_postprocess_wait_ms", "SLIME_VOICE_TOOL_POSTPROCESS_WAIT_MS"),
    )
    #: Slime model tiers: same OpenAI API key; map product ``model_option_id`` → ``OPENAI_MODEL_*`` env.
    enable_model_selector: bool = Field(
        default=True,
        validation_alias=AliasChoices("enable_model_selector", "ENABLE_MODEL_SELECTOR"),
    )
    default_model_option: str = Field(
        default="little",
        validation_alias=AliasChoices("default_model_option", "DEFAULT_MODEL_OPTION"),
    )
    #: Ultra-cheap tier (“Little Slime”); same key as other Slime tiers.
    openai_model_little: str = Field(
        default="gpt-4o-mini",
        validation_alias=AliasChoices("openai_model_little", "OPENAI_MODEL_LITTLE"),
    )
    openai_model_swift: str = Field(
        default="gpt-4.1-nano",
        validation_alias=AliasChoices("openai_model_swift", "OPENAI_MODEL_SWIFT"),
    )
    openai_model_balanced: str = Field(
        default="gpt-4.1-mini",
        validation_alias=AliasChoices("openai_model_balanced", "OPENAI_MODEL_BALANCED"),
    )
    openai_model_deep: str = Field(
        default="gpt-4.1",
        validation_alias=AliasChoices("openai_model_deep", "OPENAI_MODEL_DEEP"),
    )
    openai_model_research: str = Field(
        default="",
        validation_alias=AliasChoices("openai_model_research", "OPENAI_MODEL_RESEARCH"),
    )
    #: Easter-egg tier “5.5” (``slime_55``); hidden in the UI until legendary mode is toggled client-side.
    openai_model_slime_55: str = Field(
        default="gpt-4.1",
        validation_alias=AliasChoices("openai_model_slime_55", "OPENAI_MODEL_SLIME_55"),
    )
    model_little_multiplier: float = Field(
        default=0.35,
        ge=0.1,
        le=100.0,
        validation_alias=AliasChoices("model_little_multiplier", "MODEL_LITTLE_MULTIPLIER"),
    )
    model_swift_multiplier: float = Field(
        default=2.25,
        ge=0.1,
        le=100.0,
        validation_alias=AliasChoices("model_swift_multiplier", "MODEL_SWIFT_MULTIPLIER"),
    )
    model_balanced_multiplier: float = Field(
        default=5.0,
        ge=0.1,
        le=100.0,
        validation_alias=AliasChoices("model_balanced_multiplier", "MODEL_BALANCED_MULTIPLIER"),
    )
    model_deep_multiplier: float = Field(
        default=12.0,
        ge=0.1,
        le=100.0,
        validation_alias=AliasChoices("model_deep_multiplier", "MODEL_DEEP_MULTIPLIER"),
    )
    model_research_multiplier: float = Field(
        default=22.0,
        ge=0.1,
        le=100.0,
        validation_alias=AliasChoices("model_research_multiplier", "MODEL_RESEARCH_MULTIPLIER"),
    )
    model_slime_55_multiplier: float = Field(
        default=15.0,
        ge=0.1,
        le=100.0,
        validation_alias=AliasChoices("model_slime_55_multiplier", "MODEL_SLIME_55_MULTIPLIER"),
    )
    supabase_url: str = Field(default="", validation_alias=AliasChoices("supabase_url", "SUPABASE_URL"))
    supabase_service_role_key: str = Field(
        default="",
        validation_alias=AliasChoices("supabase_service_role_key", "SUPABASE_SERVICE_ROLE_KEY"),
    )
    supabase_anon_key: str = Field(default="", validation_alias=AliasChoices("supabase_anon_key", "SUPABASE_ANON_KEY"))
    #: When True, API routes under ``/api`` require a valid ``Authorization: Bearer`` Supabase JWT (except health/docs).
    require_auth: bool = Field(default=False, validation_alias=AliasChoices("require_auth", "REQUIRE_AUTH"))
    #: If True, keep legacy behaviour: when ``SUPABASE_URL`` is set, still allow unauthenticated ``/api`` calls that
    #: use the shared on-disk **persona** id (unsafe for multi-user). Default False: Supabase URL implies JWT-only tenancy.
    allow_persona_fallback_with_supabase: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "allow_persona_fallback_with_supabase",
            "ALLOW_PERSONA_FALLBACK_WITH_SUPABASE",
        ),
    )
    redis_url: str = Field(default="", validation_alias=AliasChoices("redis_url", "REDIS_URL"))
    allowed_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        validation_alias=AliasChoices("allowed_origins", "ALLOWED_ORIGINS"),
    )
    cors_preview_regex: str = Field(
        default="",
        validation_alias=AliasChoices("cors_preview_regex", "CORS_PREVIEW_REGEX"),
    )
    #: Auto-refresh Tier 3 profile every N newly accumulated decisions (0 disables auto-refresh).
    tier3_auto_update_every: int = Field(default=5, ge=0, validation_alias=AliasChoices("tier3_auto_update_every", "TIER3_AUTO_UPDATE_EVERY"))
    #: Require at least this many decisions before Tier 3 auto-refresh can run.
    tier3_min_decisions: int = Field(default=3, ge=1, validation_alias=AliasChoices("tier3_min_decisions", "TIER3_MIN_DECISIONS"))
    #: When True (default), memory facts tagged ``other`` are re-bucketed with a small structured LLM call before rule fallback.
    memory_fact_category_llm_refine: bool = Field(
        default=True,
        validation_alias=AliasChoices(
            "memory_fact_category_llm_refine",
            "MEMORY_FACT_CATEGORY_LLM_REFINE",
        ),
    )
    #: Enable temporal graph memory augmentation on top of vector retrieval.
    graph_enabled: bool = Field(default=False, validation_alias=AliasChoices("graph_enabled", "GRAPH_ENABLED"))
    #: Blend ratio for graph surfaced episodes in retrieval [0..1].
    graph_fusion_weight: float = Field(
        default=0.25,
        ge=0.0,
        le=1.0,
        validation_alias=AliasChoices("graph_fusion_weight", "GRAPH_FUSION_WEIGHT"),
    )
    #: Enable query-type-aware dynamic scaling on top of ``graph_fusion_weight``.
    graph_fusion_dynamic_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("graph_fusion_dynamic_enabled", "GRAPH_FUSION_DYNAMIC_ENABLED"),
    )
    #: Multiplier for graph alpha on factual/info-seeking queries.
    graph_fusion_mult_factual: float = Field(
        default=0.55,
        ge=0.0,
        le=3.0,
        validation_alias=AliasChoices("graph_fusion_mult_factual", "GRAPH_FUSION_MULT_FACTUAL"),
    )
    #: Multiplier for graph alpha on personal-memory/preference queries.
    graph_fusion_mult_personal: float = Field(
        default=1.25,
        ge=0.0,
        le=3.0,
        validation_alias=AliasChoices("graph_fusion_mult_personal", "GRAPH_FUSION_MULT_PERSONAL"),
    )
    #: Multiplier for graph alpha on planning/decision queries.
    graph_fusion_mult_planning: float = Field(
        default=1.0,
        ge=0.0,
        le=3.0,
        validation_alias=AliasChoices("graph_fusion_mult_planning", "GRAPH_FUSION_MULT_PLANNING"),
    )
    #: Multiplier for graph alpha on uncategorized/general queries.
    graph_fusion_mult_general: float = Field(
        default=0.9,
        ge=0.0,
        le=3.0,
        validation_alias=AliasChoices("graph_fusion_mult_general", "GRAPH_FUSION_MULT_GENERAL"),
    )
    #: PPR damping for graph activation.
    graph_ppr_damping: float = Field(
        default=0.85,
        ge=0.0,
        le=0.99,
        validation_alias=AliasChoices("graph_ppr_damping", "GRAPH_PPR_DAMPING"),
    )
    #: Iteration cap for PageRank convergence.
    graph_ppr_iterations: int = Field(
        default=40,
        ge=5,
        le=200,
        validation_alias=AliasChoices("graph_ppr_iterations", "GRAPH_PPR_ITERATIONS"),
    )
    #: Minimum score for including influence explanations in the report.
    graph_min_influence_score: float = Field(
        default=0.02,
        ge=0.0,
        le=1.0,
        validation_alias=AliasChoices("graph_min_influence_score", "GRAPH_MIN_INFLUENCE_SCORE"),
    )
    #: If > 0, periodically prune follow-up notify state files (seconds between runs; 0 disables).
    followup_maintenance_interval_sec: int = Field(
        default=0,
        ge=0,
        validation_alias=AliasChoices(
            "followup_maintenance_interval_sec",
            "FOLLOWUP_MAINTENANCE_INTERVAL_SEC",
        ),
    )

    # --- Slime Credits (usage limits) ---
    enable_credit_limits: bool = Field(
        default=True,
        validation_alias=AliasChoices("enable_credit_limits", "ENABLE_CREDIT_LIMITS"),
    )
    default_slime_credits: int = Field(
        default=15,
        ge=0,
        validation_alias=AliasChoices("default_slime_credits", "DEFAULT_SLIME_CREDITS"),
    )
    test_code_reward_credits: int = Field(
        default=100,
        ge=0,
        validation_alias=AliasChoices("test_code_reward_credits", "TEST_CODE_REWARD_CREDITS"),
    )
    slime_test_code: str = Field(default="", validation_alias=AliasChoices("slime_test_code", "SLIME_TEST_CODE"))
    admin_unlimited_user_ids: str = Field(
        default="",
        validation_alias=AliasChoices("admin_unlimited_user_ids", "ADMIN_UNLIMITED_USER_IDS"),
    )
    enable_admin_unlimited: bool = Field(
        default=True,
        validation_alias=AliasChoices("enable_admin_unlimited", "ENABLE_ADMIN_UNLIMITED"),
    )
    admin_user_ids: str = Field(default="", validation_alias=AliasChoices("admin_user_ids", "ADMIN_USER_IDS"))
    admin_emails: str = Field(default="", validation_alias=AliasChoices("admin_emails", "ADMIN_EMAILS"))
    admin_local_user_ids: str = Field(
        default="",
        validation_alias=AliasChoices("admin_local_user_ids", "ADMIN_LOCAL_USER_IDS"),
    )
    slime_voucher_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("slime_voucher_enabled", "SLIME_VOUCHER_ENABLED"),
    )
    slime_voucher_code: str = Field(default="", validation_alias=AliasChoices("slime_voucher_code", "SLIME_VOUCHER_CODE"))
    slime_voucher_reward_credits: int = Field(
        default=15,
        ge=0,
        validation_alias=AliasChoices("slime_voucher_reward_credits", "SLIME_VOUCHER_REWARD_CREDITS"),
    )
    slime_voucher_max_redemptions_per_user: int = Field(
        default=1,
        ge=1,
        validation_alias=AliasChoices(
            "slime_voucher_max_redemptions_per_user",
            "SLIME_VOUCHER_MAX_REDEMPTIONS_PER_USER",
        ),
    )
    credit_cost_shadow_chat: int = Field(default=1, ge=0, validation_alias=AliasChoices("CREDIT_COST_SHADOW_CHAT"))
    credit_cost_slime_chat: int = Field(default=1, ge=0, validation_alias=AliasChoices("CREDIT_COST_SLIME_CHAT"))
    credit_cost_slime_voice: int = Field(default=1, ge=0, validation_alias=AliasChoices("CREDIT_COST_SLIME_VOICE"))
    credit_cost_decision_report: int = Field(default=3, ge=0, validation_alias=AliasChoices("CREDIT_COST_DECISION_REPORT"))
    credit_cost_diary_generate: int = Field(default=2, ge=0, validation_alias=AliasChoices("CREDIT_COST_DIARY_GENERATE"))
    credit_cost_memory_import: int = Field(default=3, ge=0, validation_alias=AliasChoices("CREDIT_COST_MEMORY_IMPORT"))
    credit_cost_calendar_agent: int = Field(default=1, ge=0, validation_alias=AliasChoices("CREDIT_COST_CALENDAR_AGENT"))
    credit_cost_resource_search: int = Field(default=2, ge=0, validation_alias=AliasChoices("CREDIT_COST_RESOURCE_SEARCH"))
    credit_cost_report_revision: int = Field(
        default=3, ge=0, validation_alias=AliasChoices("CREDIT_COST_REPORT_REVISION")
    )
    credit_cost_task_decomposition: int = Field(
        default=2, ge=0, validation_alias=AliasChoices("CREDIT_COST_TASK_DECOMPOSITION")
    )
    credit_cost_outcome_reflection: int = Field(
        default=2, ge=0, validation_alias=AliasChoices("CREDIT_COST_OUTCOME_REFLECTION")
    )
    credit_cost_tts: int = Field(default=1, ge=0, validation_alias=AliasChoices("CREDIT_COST_TTS"))
    credit_cost_asr: int = Field(default=0, ge=0, validation_alias=AliasChoices("CREDIT_COST_ASR"))

    @field_validator(
        "redis_url",
        "allowed_origins",
        "cors_preview_regex",
        "supabase_url",
        "supabase_anon_key",
        "supabase_service_role_key",
        "openai_api_key",
        "openai_tts_model",
        "openai_tts_voice",
        "openai_tts_instructions",
        "resilience_secondary_openai_api_key",
        "resilience_secondary_openai_api_base",
        "resilience_secondary_openai_model",
        "fx_llm_primary",
        "fx_llm_fallback",
        "fx_llm_failover_order",
        "tavily_api_key",
        mode="before",
    )
    @classmethod
    def _strip_outer_quotes_env_strings(cls, v: object) -> str:
        return _strip_outer_quotes_str(v)

    @field_validator("slime_test_code", "slime_voucher_code", mode="before")
    @classmethod
    def _strip_outer_quotes_codes(cls, v: object) -> str:
        return _strip_outer_quotes_str(v)

    @field_validator("admin_emails", mode="before")
    @classmethod
    def _normalize_admin_emails(cls, v: object) -> str:
        s = _strip_outer_quotes_str(v)
        for ch in ("\u201c", "\u201d", "\u2018", "\u2019"):
            s = s.replace(ch, "")
        return s.strip()

    @model_validator(mode="after")
    def _supabase_implies_jwt_tenancy(self) -> Self:
        """Chroma, traces, profile, chat_threads, graph — all keyed by ``foresight_user_id`` from JWT ``sub``."""
        if (self.supabase_url or "").strip() and not self.allow_persona_fallback_with_supabase:
            object.__setattr__(self, "require_auth", True)
        return self

    @property
    def memory_dir(self) -> Path:
        return self.foresight_data_dir / "memory"

    @property
    def world_cache_dir(self) -> Path:
        return self.foresight_data_dir / "world_cache"

    @property
    def traces_dir(self) -> Path:
        return self.foresight_data_dir / "traces"

    @property
    def profile_dir(self) -> Path:
        return self.foresight_data_dir / "profile"

    @property
    def outcomes_dir(self) -> Path:
        return self.foresight_data_dir / "outcomes"

    @property
    def followups_dir(self) -> Path:
        return self.foresight_data_dir / "followups"

    @property
    def commits_dir(self) -> Path:
        return self.foresight_data_dir / "commits"

    @property
    def evaluation_logs_dir(self) -> Path:
        return self.foresight_data_dir / "evaluation_logs"

    @property
    def graph_dir(self) -> Path:
        return self.foresight_data_dir / "graph"

    @property
    def cors_origins_list(self) -> list[str]:
        out: list[str] = []
        for x in self.allowed_origins.split(","):
            t = _strip_outer_quotes_str(x.strip())
            if t:
                out.append(t)
        return out


def load_settings() -> Settings:
    return Settings()
