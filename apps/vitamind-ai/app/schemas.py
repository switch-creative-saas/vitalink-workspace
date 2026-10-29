"""Request and response models."""
from typing import Any, Literal

import json

from pydantic import BaseModel, Field, field_validator

SourceType = Literal["pubmed", "guideline", "fmoh"]


class EmbedRequest(BaseModel):
    text: str = Field(min_length=20, max_length=200_000)
    source_url: str = Field(min_length=4, max_length=500)
    title: str = Field(min_length=2, max_length=300)
    source_type: SourceType


class EmbedResponse(BaseModel):
    chunks: int
    ids: list[str]


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
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

    @field_validator("vitals", "history", "medications", "allergies")
    @classmethod
    def not_too_large(cls, value):
        # Keeps prompts (and the bill) bounded even if a caller sends a huge record.
        if value is not None and len(json.dumps(value, default=str)) > 20_000:
            raise ValueError("EMR snapshot field is too large")
        return value


class DiagnoseRequest(BaseModel):
    session_id: str
    chief_complaint: str = Field(min_length=3, max_length=2000)
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
