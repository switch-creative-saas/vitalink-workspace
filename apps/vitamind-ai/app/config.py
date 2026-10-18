"""Settings for the VitaMind AI service, read from the environment (or a .env file)."""
import os
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_key: str
    openai_api_key: str
    anthropic_api_key: str
    # Shared secret the VitaLink edge function sends in X-VitaMind-Token. The service
    # holds the Supabase service key and paid API keys, so it never runs open.
    service_token: str
    model: str
    embedding_model: str
    max_tokens: int


@lru_cache
def get_settings() -> Settings:
    return Settings(
        supabase_url=os.environ.get("SUPABASE_URL", ""),
        supabase_service_key=os.environ.get("SUPABASE_SERVICE_KEY", ""),
        openai_api_key=os.environ.get("OPENAI_API_KEY", ""),
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        service_token=os.environ.get("VITAMIND_SERVICE_TOKEN", ""),
        model=os.environ.get("VITAMIND_MODEL", "claude-sonnet-4-6"),
        embedding_model=os.environ.get("VITAMIND_EMBEDDING_MODEL", "text-embedding-3-small"),
        max_tokens=int(os.environ.get("VITAMIND_MAX_TOKENS", "2000")),
    )
