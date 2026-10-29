"""VitaMind AI service: embeddings, vector search, Claude diagnosis, feedback logging, paper-record
extraction and the consultation scribe.

Only the VitaLink edge functions call this service (header X-VitaMind-Token); it
never talks to browsers directly.
"""
import hmac
import logging

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from . import assist
from . import diagnose as diagnose_pipeline
from . import knowledge
from .clients import get_anthropic, get_openai, get_supabase
from .config import get_settings
from .limits import Usage, check_rate, ensure_budget
from .schemas import (
    DiagnoseRequest,
    ExtractPatientsRequest,
    ExtractPatientsResponse,
    ScribeNoteOutput,
    ScribeNoteRequest,
    TranscribeRequest,
    TranscribeResponse,
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

MAX_BODY_BYTES = 1_000_000
# Photos and audio segments are bigger than text requests (Vercel itself stops at 4.5 MB).
MAX_BODY_BYTES_BY_PATH = {"/extract-patients": 4_500_000, "/transcribe": 4_500_000}


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    """Rejects oversized requests before they are read (prompts and embeddings cost per token)."""
    length = request.headers.get("content-length")
    limit = MAX_BODY_BYTES_BY_PATH.get(request.url.path, MAX_BODY_BYTES)
    if length and length.isdigit() and int(length) > limit:
        return JSONResponse({"detail": "Request too large"}, status_code=413)
    return await call_next(request)


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
    check_rate()
    ensure_budget(supabase, "embed")
    usage = Usage()
    try:
        ids = knowledge.store(supabase, openai_client, text=req.text, source_url=req.source_url, title=req.title, source_type=req.source_type, usage=usage)
    finally:
        usage.save(supabase)
    return EmbedResponse(chunks=len(ids), ids=ids)


@app.post("/search", response_model=list[KnowledgeChunk], dependencies=[Depends(require_token)])
def search(req: SearchRequest, supabase=Depends(get_supabase), openai_client=Depends(get_openai)) -> list[KnowledgeChunk]:
    check_rate()
    ensure_budget(supabase, "embed")
    usage = Usage()
    try:
        return knowledge.search(supabase, openai_client, req.query, top_k=req.top_k, usage=usage)
    finally:
        usage.save(supabase)


@app.post("/diagnose", response_model=DiagnoseResponse, dependencies=[Depends(require_token)])
def diagnose(
    req: DiagnoseRequest,
    supabase=Depends(get_supabase),
    openai_client=Depends(get_openai),
    anthropic_client=Depends(get_anthropic),
) -> DiagnoseResponse:
    check_rate()
    ensure_budget(supabase, "llm")
    ensure_budget(supabase, "embed")
    usage = Usage()
    try:
        return diagnose_pipeline.run(req, supabase=supabase, openai_client=openai_client, anthropic_client=anthropic_client, usage=usage)
    except diagnose_pipeline.ModelOutputError as error:
        log.warning("diagnose failed: %s", error)
        raise HTTPException(502, "VitaMind could not produce a valid answer. Please try again.") from error
    finally:
        usage.save(supabase)


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


@app.post("/extract-patients", response_model=ExtractPatientsResponse, dependencies=[Depends(require_token)])
def extract_patients(req: ExtractPatientsRequest, supabase=Depends(get_supabase), anthropic_client=Depends(get_anthropic)) -> ExtractPatientsResponse:
    check_rate()
    ensure_budget(supabase, "llm")
    usage = Usage()
    try:
        return assist.extract_patients(req, anthropic_client=anthropic_client, usage=usage)
    except diagnose_pipeline.ModelOutputError as error:
        log.warning("extract failed: %s", error)
        raise HTTPException(502, "The photo could not be read. Try a sharper, well-lit photo.") from error
    finally:
        usage.save(supabase)


@app.post("/transcribe", response_model=TranscribeResponse, dependencies=[Depends(require_token)])
def transcribe(req: TranscribeRequest, supabase=Depends(get_supabase), openai_client=Depends(get_openai)) -> TranscribeResponse:
    check_rate()
    ensure_budget(supabase, "audio")
    usage = Usage()
    try:
        return TranscribeResponse(text=assist.transcribe(req, openai_client=openai_client, usage=usage))
    except ValueError as error:  # bad base64
        raise HTTPException(422, "The audio could not be read.") from error
    finally:
        usage.save(supabase)


@app.post("/scribe-note", response_model=ScribeNoteOutput, dependencies=[Depends(require_token)])
def scribe_note(req: ScribeNoteRequest, supabase=Depends(get_supabase), anthropic_client=Depends(get_anthropic)) -> ScribeNoteOutput:
    check_rate()
    ensure_budget(supabase, "llm")
    usage = Usage()
    try:
        return assist.scribe_note(req, anthropic_client=anthropic_client, usage=usage)
    except diagnose_pipeline.ModelOutputError as error:
        log.warning("scribe note failed: %s", error)
        raise HTTPException(502, "VitaMind could not draft the note. Please try again.") from error
    finally:
        usage.save(supabase)
