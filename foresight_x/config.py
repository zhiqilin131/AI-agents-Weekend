"""Runtime configuration from environment."""

from __future__ import annotations

from pathlib import Path
from typing import Self

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # Allow ``Settings(chroma_persist_dir=..., foresight_data_dir=...)``; without this,
        # validation_alias-only fields ignore constructor kwargs and fall back to .env/defaults.
        populate_by_name=True,
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
    #: Enable temporal graph memory augmentation on top of vector retrieval.
    graph_enabled: bool = Field(default=False, validation_alias=AliasChoices("graph_enabled", "GRAPH_ENABLED"))
    #: Blend ratio for graph surfaced episodes in retrieval [0..1].
    graph_fusion_weight: float = Field(
        default=0.25,
        ge=0.0,
        le=1.0,
        validation_alias=AliasChoices("graph_fusion_weight", "GRAPH_FUSION_WEIGHT"),
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
    credit_cost_decision_report: int = Field(default=5, ge=0, validation_alias=AliasChoices("CREDIT_COST_DECISION_REPORT"))
    credit_cost_diary_generate: int = Field(default=2, ge=0, validation_alias=AliasChoices("CREDIT_COST_DIARY_GENERATE"))
    credit_cost_memory_import: int = Field(default=3, ge=0, validation_alias=AliasChoices("CREDIT_COST_MEMORY_IMPORT"))
    credit_cost_calendar_agent: int = Field(default=1, ge=0, validation_alias=AliasChoices("CREDIT_COST_CALENDAR_AGENT"))
    credit_cost_resource_search: int = Field(default=1, ge=0, validation_alias=AliasChoices("CREDIT_COST_RESOURCE_SEARCH"))
    credit_cost_tts: int = Field(default=1, ge=0, validation_alias=AliasChoices("CREDIT_COST_TTS"))
    credit_cost_asr: int = Field(default=0, ge=0, validation_alias=AliasChoices("CREDIT_COST_ASR"))

    @field_validator("slime_test_code", "slime_voucher_code", mode="before")
    @classmethod
    def _strip_outer_quotes_codes(cls, v: object) -> str:
        """Railway/.env sometimes stores values wrapped in ASCII quotes; strip so hashes match user input."""
        if v is None:
            return ""
        s = str(v).strip()
        if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
            return s[1:-1].strip()
        return s

    @field_validator("admin_emails", mode="before")
    @classmethod
    def _normalize_admin_emails(cls, v: object) -> str:
        if v is None:
            return ""
        s = str(v).strip()
        if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
            s = s[1:-1].strip()
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
        return [x.strip() for x in self.allowed_origins.split(",") if x.strip()]


def load_settings() -> Settings:
    return Settings()
