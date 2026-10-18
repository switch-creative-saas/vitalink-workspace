"""The VitaMind system prompt and the user message built around it."""
import json

from .schemas import DiagnoseRequest, KnowledgeChunk

SYSTEM_PROMPT = """You are VitaMind, a clinical decision support AI for Nigerian healthcare facilities. You assist — you do not replace — clinicians.

Given the patient record and relevant clinical guidelines below, return ONLY valid JSON in this exact format:
{
  "differential": [
    {"condition": string, "probability": "high|medium|low", "supporting_evidence": [string], "against_evidence": [string]}
  ],
  "confidence_score": number (0-1),
  "red_flags": [string],
  "recommended_actions": [string],
  "citations": [{"title": string, "source": string}],
  "requires_urgent_review": boolean,
  "disclaimer": "This output is for clinical decision support only. Final diagnosis must be made by a qualified clinician."
}

Nigerian clinical context: consider endemic conditions including malaria, typhoid, sickle cell disease, tuberculosis, and hypertension as part of your differential where epidemiologically appropriate.

Never fabricate citations. Only cite sources provided in the context below."""

MAX_CHUNK_CHARS = 1800


def build_user_message(req: DiagnoseRequest, chunks: list[KnowledgeChunk]) -> str:
    """Patient record (de-identified: no name, phone or ID) plus the retrieved sources."""
    record = {"chief_complaint": req.chief_complaint, **req.emr_snapshot.model_dump(exclude_none=True)}
    if chunks:
        sources = "\n\n".join(
            f"[{i}] {c.title}\nSource: {c.source_url}\n{c.chunk_text[:MAX_CHUNK_CHARS]}" for i, c in enumerate(chunks, start=1)
        )
    else:
        sources = "(No guideline excerpts matched this case. Return an empty citations list.)"
    return (
        "PATIENT RECORD\n"
        f"{json.dumps(record, indent=2, default=str)}\n\n"
        "RELEVANT CLINICAL GUIDELINES AND LITERATURE\n"
        f"{sources}\n\n"
        "Cite a source only by its exact title and its Source URL as listed above."
    )
