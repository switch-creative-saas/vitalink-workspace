"""Spend protection for the paid model APIs (Anthropic for diagnosis, OpenAI for embeddings).

Three layers, all independent of the VitaLink edge function's own per-user and per-workspace
limits, so a leaked service token or a bug still can't run up an unbounded bill:

* a per-minute request limit for the whole service (in memory);
* daily request and token budgets per kind ("llm", "embed"), counted in Supabase from the
  usage the providers report (public.ai_usage_daily), checked before every paid call;
* request size caps (see schemas.py and the body-size check in main.py).
"""
from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass

from fastapi import HTTPException

from .config import get_settings

_lock = threading.Lock()
_recent: deque[float] = deque()


def check_rate() -> None:
    """Raises 429 once more than VITAMIND_MAX_REQUESTS_PER_MINUTE requests arrived in 60 seconds."""
    limit = get_settings().max_requests_per_minute
    now = time.monotonic()
    with _lock:
        while _recent and now - _recent[0] > 60:
            _recent.popleft()
        if len(_recent) >= limit:
            raise HTTPException(429, "VitaMind AI is busy. Try again in a minute.")
        _recent.append(now)


def _budget(kind: str) -> tuple[int, int]:
    s = get_settings()
    return (s.daily_llm_requests, s.daily_llm_tokens) if kind == "llm" else (s.daily_embed_requests, s.daily_embed_tokens)


def _read(data) -> tuple[int, int]:
    if isinstance(data, dict):
        return int(data.get("requests") or 0), int(data.get("tokens") or 0)
    return 0, 0


def ensure_budget(supabase, kind: str) -> None:
    """Refuses (429) when today's requests or tokens for this kind have reached the budget."""
    max_requests, max_tokens = _budget(kind)
    try:
        requests, tokens = _read(supabase.rpc("ai_usage_today", {"p_kind": kind}).execute().data)
    except Exception as error:  # fail closed: no budget check, no paid call
        raise HTTPException(503, "VitaMind AI usage could not be checked. Try again shortly.") from error
    if requests >= max_requests or tokens >= max_tokens:
        raise HTTPException(429, "VitaMind AI has reached today's usage limit. It resets at midnight UTC.")


def record(supabase, kind: str, requests: int, tokens: int) -> None:
    try:
        supabase.rpc("ai_usage_add", {"p_kind": kind, "p_requests": requests, "p_tokens": tokens}).execute()
    except Exception:  # never fail a finished answer over bookkeeping
        pass


@dataclass
class Usage:
    """Tokens the providers reported during one request."""

    llm_requests: int = 0
    llm_tokens: int = 0
    embed_requests: int = 0
    embed_tokens: int = 0

    def add_llm(self, response) -> None:
        usage = getattr(response, "usage", None)
        self.llm_requests += 1
        self.llm_tokens += int(getattr(usage, "input_tokens", 0) or 0) + int(getattr(usage, "output_tokens", 0) or 0)

    def add_embed(self, response) -> None:
        usage = getattr(response, "usage", None)
        self.embed_requests += 1
        self.embed_tokens += int(getattr(usage, "total_tokens", 0) or getattr(usage, "prompt_tokens", 0) or 0)

    def save(self, supabase) -> None:
        if self.llm_requests:
            record(supabase, "llm", self.llm_requests, self.llm_tokens)
        if self.embed_requests:
            record(supabase, "embed", self.embed_requests, self.embed_tokens)
