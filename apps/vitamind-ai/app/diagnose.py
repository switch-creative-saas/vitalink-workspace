"""The /diagnose pipeline: retrieve sources, ask Claude, validate, keep only real citations, save."""
import json
import re
import time

from pydantic import ValidationError

from . import knowledge
from .config import get_settings
from .prompt import SYSTEM_PROMPT, build_user_message
from .schemas import DISCLAIMER, Citation, DiagnoseOutput, DiagnoseRequest, DiagnoseResponse, KnowledgeChunk

RETRY_MESSAGE = "Your previous reply was not valid JSON in the required format. Reply again with ONLY the JSON object, nothing else."


class ModelOutputError(Exception):
    """The model did not return usable JSON after a retry."""


def extract_json(text: str) -> dict:
    """Parse the model's reply, tolerating code fences or stray prose around the object."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end <= start:
            raise
        return json.loads(cleaned[start : end + 1])


def _norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def keep_real_citations(citations: list[Citation], chunks: list[KnowledgeChunk]) -> list[Citation]:
    """Drop any citation that does not match a source we actually gave the model."""
    by_url = {c.source_url.strip().rstrip("/"): c for c in chunks}
    by_title = {_norm(c.title): c for c in chunks}
    kept: list[Citation] = []
    seen: set[str] = set()
    for citation in citations:
        source = by_url.get(citation.source.strip().rstrip("/")) or by_title.get(_norm(citation.title))
        if source and source.source_url not in seen:
            seen.add(source.source_url)
            kept.append(Citation(title=source.title, source=source.source_url))
    return kept


def call_model(anthropic_client, user_message: str) -> tuple[DiagnoseOutput, str]:
    settings = get_settings()
    messages = [{"role": "user", "content": user_message}]
    last_error: Exception | None = None
    raw = ""
    for _attempt in range(2):
        response = anthropic_client.messages.create(
            model=settings.model,
            max_tokens=settings.max_tokens,
            temperature=0.2,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        raw = "".join(block.text for block in response.content if getattr(block, "type", "text") == "text")
        try:
            return DiagnoseOutput.model_validate(extract_json(raw)), raw
        except (json.JSONDecodeError, ValidationError) as error:
            last_error = error
            messages = [*messages, {"role": "assistant", "content": raw}, {"role": "user", "content": RETRY_MESSAGE}]
    raise ModelOutputError(f"VitaMind could not produce a valid answer: {last_error}") from last_error


def run(req: DiagnoseRequest, *, supabase, openai_client, anthropic_client) -> DiagnoseResponse:
    started = time.monotonic()
    query = req.chief_complaint
    history = req.emr_snapshot.history
    if isinstance(history, dict) and history.get("chronic_conditions"):
        query = f"{query}. Known conditions: {history['chronic_conditions']}"
    chunks = knowledge.search(supabase, openai_client, query, top_k=5)

    user_message = build_user_message(req, chunks)
    output, raw = call_model(anthropic_client, user_message)
    output.citations = keep_real_citations(output.citations, chunks)
    output.disclaimer = DISCLAIMER
    latency_ms = int((time.monotonic() - started) * 1000)

    model = get_settings().model
    saved = (
        supabase.table("vitamind_results")
        .insert(
            {
                "session_id": req.session_id,
                "differential": [d.model_dump() for d in output.differential],
                "confidence_score": output.confidence_score,
                "citations": [c.model_dump() for c in output.citations],
                "red_flags": output.red_flags,
                "recommended_actions": output.recommended_actions,
                "requires_urgent_review": output.requires_urgent_review,
                "raw_prompt": f"{SYSTEM_PROMPT}\n\n---\n\n{user_message}",
                "raw_response": raw,
                "model_used": model,
                "latency_ms": latency_ms,
            }
        )
        .execute()
    )
    result_id = str(saved.data[0]["id"])
    return DiagnoseResponse(
        **output.model_dump(), result_id=result_id, session_id=req.session_id, model_used=model, latency_ms=latency_ms, sources=chunks
    )
