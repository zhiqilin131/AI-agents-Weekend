"""Runtime configuration from environment."""

from pathlib import Path

from pydantic import AliasChoices, Field
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
    #: Auto-refresh Tier 3 profile every N newly accumulated decisions (0 disables auto-refresh).
    tier3_auto_update_every: int = Field(default=5, ge=0, validation_alias=AliasChoices("tier3_auto_update_every", "TIER3_AUTO_UPDATE_EVERY"))
    #: Require at least this many decisions before Tier 3 auto-refresh can run.
    tier3_min_decisions: int = Field(default=3, ge=1, validation_alias=AliasChoices("tier3_min_decisions", "TIER3_MIN_DECISIONS"))

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
    def commits_dir(self) -> Path:
        return self.foresight_data_dir / "commits"

    @property
    def evaluation_logs_dir(self) -> Path:
        return self.foresight_data_dir / "evaluation_logs"


def load_settings() -> Settings:
    return Settings()
