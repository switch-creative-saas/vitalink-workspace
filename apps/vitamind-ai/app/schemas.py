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


# ---------- paper records (OCR) ----------

class RecordImage(BaseModel):
    media_type: Literal["image/jpeg", "image/png", "image/webp"]
    # base64; the browser resizes to ~1600px and keeps each photo under ~1 MB so a batch of four
    # fits Vercel's 4.5 MB request limit.
    data: str = Field(min_length=100, max_length=1_000_000)


class ExtractPatientsRequest(BaseModel):
    images: list[RecordImage] = Field(min_length=1, max_length=4)


class ExtractedPatient(BaseModel):
    first_name: str = ""
    middle_name: str | None = None
    last_name: str = ""
    date_of_birth: str | None = None
    age_years: float | None = None
    gender: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    state: str | None = None
    occupation: str | None = None
    marital_status: str | None = None
    blood_group: str | None = None
    genotype: str | None = None
    allergies: str | None = None
    chronic_conditions: str | None = None
    current_medications: str | None = None
    emergency_contact_name: str | None = None
    emergency_relationship: str | None = None
    emergency_phone: str | None = None
    insurance_provider: str | None = None
    insurance_policy_number: str | None = None
    hospital_number: str | None = None
    confidence: Literal["high", "medium", "low"] = "medium"
    unclear_fields: list[str] = []


class ExtractPatientsResponse(BaseModel):
    document_type: str = "other"
    patients: list[ExtractedPatient] = Field(default_factory=list, max_length=60)
    notes: str = ""


# ---------- consultation scribe ----------

class TranscribeRequest(BaseModel):
    # One recorded segment (about a minute); base64, at most ~3 MB.
    audio: str = Field(min_length=100, max_length=4_000_000)
    mime_type: str = Field(default="audio/webm", max_length=60)
    seconds: int = Field(ge=1, le=300)
    previous_text: str = Field(default="", max_length=2000)


class TranscribeResponse(BaseModel):
    text: str


class FindingCode(BaseModel):
    id: str = Field(max_length=60)
    label: str = Field(max_length=200)


class ScribeNoteRequest(BaseModel):
    transcript: str = Field(min_length=20, max_length=120_000)
    emr_snapshot: EmrSnapshot = EmrSnapshot()
    findings: list[FindingCode] = Field(default_factory=list, max_length=400)


class PossibleDiagnosis(BaseModel):
    condition: str
    likelihood: Literal["high", "medium", "low"] = "medium"
    why: str = ""


class ScribeNoteOutput(BaseModel):
    chief_complaint: str = ""
    history_of_present_illness: str = ""
    review_of_systems: str = ""
    examination: str = ""
    assessment: str = ""
    plan: str = ""
    follow_up: str = ""
    findings_present: list[str] = []
    findings_absent: list[str] = []
    possible_diagnoses: list[PossibleDiagnosis] = []
    red_flags: list[str] = []
    questions_to_ask: list[str] = []
