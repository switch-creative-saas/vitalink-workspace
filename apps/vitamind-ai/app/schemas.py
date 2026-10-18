"""Request and response models."""
from typing import Any, Literal

from pydantic import BaseModel, Field

SourceType = Literal["pubmed", "guideline", "fmoh"]


class EmbedRequest(BaseModel):
    text: str = Field(min_length=20)
    source_url: str = Field(min_length=4)
    title: str = Field(min_length=2)
    source_type: SourceType


class EmbedResponse(BaseModel):
    chunks: int
    ids: list[str]


class SearchRequest(BaseModel):
    query: str = Field(min_length=2)
    top_k: int = Field(default=5, ge=1, le=20)


class KnowledgeChunk(BaseModel):
    id: str
    title: str
    source_url: str
    source_type: str
    chunk_text: str
    similarity: float


class EmrSnapshot(BaseModel):
    vitals: list[dict[str, Any]] | dict[str, Any] | None = None
    history: dict[str, Any] | list[Any] | str | None = None
    medications: list[Any] | str | None = None
    allergies: list[Any] | str | None = None
    age: int | None = None
    sex: str | None = None


class DiagnoseRequest(BaseModel):
    session_id: str
    chief_complaint: str = Field(min_length=3)
    emr_snapshot: EmrSnapshot = EmrSnapshot()


class DifferentialItem(BaseModel):
    condition: str
    probability: Literal["high", "medium", "low"]
    supporting_evidence: list[str] = []
    against_evidence: list[str] = []


class Citation(BaseModel):
    title: str
    source: str


DISCLAIMER = "This output is for clinical decision support only. Final diagnosis must be made by a qualified clinician."


class DiagnoseOutput(BaseModel):
    """The JSON shape the model must return (see prompt.SYSTEM_PROMPT)."""

    differential: list[DifferentialItem]
    confidence_score: float = Field(ge=0, le=1)
    red_flags: list[str] = []
    recommended_actions: list[str] = []
    citations: list[Citation] = []
    requires_urgent_review: bool = False
    disclaimer: str = DISCLAIMER


class DiagnoseResponse(DiagnoseOutput):
    result_id: str
    session_id: str
    model_used: str
    latency_ms: int
    sources: list[KnowledgeChunk] = []


class FeedbackRequest(BaseModel):
    result_id: str
    clinician_id: str
    action: Literal["confirm", "override", "partial"]
    actual_diagnosis: str | None = None
    notes: str | None = None


class FeedbackResponse(BaseModel):
    id: str
