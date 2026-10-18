"""External clients, created once and injected into routes (tests swap them for fakes)."""
from functools import lru_cache

from anthropic import Anthropic
from openai import OpenAI
from supabase import Client, create_client

from .config import get_settings


@lru_cache
def get_supabase() -> Client:
    s = get_settings()
    if not s.supabase_url or not s.supabase_service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(s.supabase_url, s.supabase_service_key)


@lru_cache
def get_openai() -> OpenAI:
    key = get_settings().openai_api_key
    if not key:
        raise RuntimeError("OPENAI_API_KEY must be set")
    return OpenAI(api_key=key)


@lru_cache
def get_anthropic() -> Anthropic:
    key = get_settings().anthropic_api_key
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY must be set")
    return Anthropic(api_key=key)
