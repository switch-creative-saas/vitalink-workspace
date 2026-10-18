"""VitaMind AI service: embeddings, vector search, Claude diagnosis and feedback logging.

Only the VitaLink edge functions call this service (header X-VitaMind-Token); it
never talks to browsers directly.
"""
import hmac
import logging

from fastapi import Depends, FastAPI, Header, HTTPException

from . import diagnose as diagnose_pipeline
from . import knowledge
from .clients import get_anthropic, get_openai, get_supabase
from .config import get_settings
from .schemas import (
    DiagnoseRequest,
    DiagnoseResponse,
    EmbedRequest,
    EmbedResponse,
    FeedbackRequest,
    FeedbackResponse,
    KnowledgeChunk,
    SearchRequest,
)

log = logging.getLogger("vitamind")
app = FastAPI(title="VitaMind AI", version="1.0.0")


def require_token(x_vitamind_token: str = Header(default="")) -> None:
    expected = get_settings().service_token
    if not expected:
        raise HTTPException(503, "VITAMIND_SERVICE_TOKEN is not set on the service")
    if not hmac.compare_digest(x_vitamind_token, expected):
        raise HTTPException(401, "Invalid service token")


@app.get("/health")
def health() -> dict:
    s = get_settings()
    return {
        "ok": True,
        "model": s.model,
        "configured": {
            "supabase": bool(s.supabase_url and s.supabase_service_key),
            "openai": bool(s.openai_api_key),
            "anthropic": bool(s.anthropic_api_key),
            "token": bool(s.service_token),
        },
    }


@app.post("/embed", response_model=EmbedResponse, dependencies=[Depends(require_token)])
def embed(req: EmbedRequest, supabase=Depends(get_supabase), openai_client=Depends(get_openai)) -> EmbedResponse:
    ids = knowledge.store(supabase, openai_client, text=req.text, source_url=req.source_url, title=req.title, source_type=req.source_type)
    return EmbedResponse(chunks=len(ids), ids=ids)


@app.post("/search", response_model=list[KnowledgeChunk], dependencies=[Depends(require_token)])
def search(req: SearchRequest, supabase=Depends(get_supabase), openai_client=Depends(get_openai)) -> list[KnowledgeChunk]:
    return knowledge.search(supabase, openai_client, req.query, top_k=req.top_k)


@app.post("/diagnose", response_model=DiagnoseResponse, dependencies=[Depends(require_token)])
def diagnose(
    req: DiagnoseRequest,
    supabase=Depends(get_supabase),
    openai_client=Depends(get_openai),
    anthropic_client=Depends(get_anthropic),
) -> DiagnoseResponse:
    try:
        return diagnose_pipeline.run(req, supabase=supabase, openai_client=openai_client, anthropic_client=anthropic_client)
    except diagnose_pipeline.ModelOutputError as error:
        log.warning("diagnose failed: %s", error)
        raise HTTPException(502, "VitaMind could not produce a valid answer. Please try again.") from error


@app.post("/feedback", response_model=FeedbackResponse, dependencies=[Depends(require_token)])
def feedback(req: FeedbackRequest, supabase=Depends(get_supabase)) -> FeedbackResponse:
    if req.action == "override" and not (req.actual_diagnosis or "").strip():
        raise HTTPException(422, "An override needs the actual diagnosis")
    result = (
        supabase.table("vitamind_feedback")
        .insert(
            {
                "result_id": req.result_id,
                "clinician_id": req.clinician_id,
                "action": req.action,
                "actual_diagnosis": (req.actual_diagnosis or "").strip() or None,
                "notes": (req.notes or "").strip() or None,
            }
        )
        .execute()
    )
    return FeedbackResponse(id=str(result.data[0]["id"]))
