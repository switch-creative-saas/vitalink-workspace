"""Paper-record extraction (Claude vision), consultation transcription (OpenAI) and scribe notes (Claude).

The VitaLink edge function vitamind-assist checks the user, plan and rate limits and calls these
through main.py; nothing here is stored except the usage counts (limits.Usage).
"""
import base64
import json

from pydantic import BaseModel, ValidationError

from .config import get_settings
from .diagnose import ModelOutputError, RETRY_MESSAGE, extract_json
from .schemas import (
    ExtractPatientsRequest,
    ExtractPatientsResponse,
    ScribeNoteOutput,
    ScribeNoteRequest,
    TranscribeRequest,
)

EXTRACT_SYSTEM = """You read photographs of paper hospital records from Nigerian clinics: patient cards, registration forms, folders and register/log books (often handwritten). Extract every patient you can see.

Return ONLY valid JSON:
{
  "document_type": "patient_card|registration_form|register_page|clinical_note|other",
  "patients": [
    {
      "first_name": string, "middle_name": string|null, "last_name": string,
      "date_of_birth": "YYYY-MM-DD"|null, "age_years": number|null, "gender": "male|female"|null,
      "phone": string|null, "email": string|null, "address": string|null, "state": string|null,
      "occupation": string|null, "marital_status": string|null,
      "blood_group": string|null, "genotype": string|null,
      "allergies": string|null, "chronic_conditions": string|null, "current_medications": string|null,
      "emergency_contact_name": string|null, "emergency_relationship": string|null, "emergency_phone": string|null,
      "insurance_provider": string|null, "insurance_policy_number": string|null,
      "hospital_number": string|null,
      "confidence": "high|medium|low",
      "unclear_fields": [string]
    }
  ],
  "notes": string
}

Rules:
- Copy what is written; never invent values. Use null when a field is missing or illegible, and list fields you had to guess in unclear_fields.
- A register page usually has one patient per row: return one entry per row.
- Write dates as YYYY-MM-DD (Nigerian records are day/month/year). If only an age is written, set age_years and leave date_of_birth null.
- Keep Nigerian phone numbers as written (e.g. 0803..., +234...).
- Split full names into first and last name; Nigerian names are usually written SURNAME first in registers when in capitals.
- "notes" is one short sentence about anything the clinic should check (e.g. a torn or blurred section)."""

SCRIBE_SYSTEM = """You are VitaMind Scribe for clinicians in Nigerian hospitals. You receive the transcript of a consultation between a doctor and a patient (it may mix English, Nigerian Pidgin, Yoruba, Igbo or Hausa, and speakers are not labelled), plus a de-identified summary of the patient's record and a list of symptom/finding codes.

Return ONLY valid JSON:
{
  "chief_complaint": string,
  "history_of_present_illness": string,
  "review_of_systems": string,
  "examination": string,
  "assessment": string,
  "plan": string,
  "follow_up": string,
  "findings_present": [code],
  "findings_absent": [code],
  "possible_diagnoses": [{"condition": string, "likelihood": "high|medium|low", "why": string}],
  "red_flags": [string],
  "questions_to_ask": [string]
}

Rules:
- Write in clear clinical English, third person ("Patient reports ..."). Translate non-English speech.
- Only record what was said. Leave a section as "" if it was not discussed; never invent examination findings, vitals, results or doses.
- findings_present / findings_absent must use codes from the list given, only for things the patient or doctor actually confirmed or denied.
- possible_diagnoses is decision support for the doctor (at most 5); the doctor makes the diagnosis. Consider endemic conditions (malaria, typhoid, sickle cell disease, tuberculosis, hypertension) where appropriate.
- red_flags: anything in the conversation that needs urgent attention.
- questions_to_ask: important things the doctor has not yet asked (at most 5)."""


def _ask_json(anthropic_client, *, system: str, content, model_type: type[BaseModel], max_tokens: int, usage=None):
    """One Claude call that must return JSON matching model_type; retried once on bad output."""
    settings = get_settings()
    messages = [{"role": "user", "content": content}]
    last_error: Exception | None = None
    for _attempt in range(2):
        response = anthropic_client.messages.create(
            model=settings.model, max_tokens=max_tokens, temperature=0.1, system=system, messages=messages,
        )
        if usage is not None:
            usage.add_llm(response)
        raw = "".join(block.text for block in response.content if getattr(block, "type", "text") == "text")
        try:
            return model_type.model_validate(extract_json(raw))
        except (json.JSONDecodeError, ValidationError) as error:
            last_error = error
            messages = [*messages, {"role": "assistant", "content": raw}, {"role": "user", "content": RETRY_MESSAGE}]
    raise ModelOutputError(f"VitaMind could not read the answer: {last_error}") from last_error


def extract_patients(req: ExtractPatientsRequest, *, anthropic_client, usage=None) -> ExtractPatientsResponse:
    content: list[dict] = [
        {"type": "image", "source": {"type": "base64", "media_type": image.media_type, "data": image.data}} for image in req.images
    ]
    content.append({"type": "text", "text": f"{len(req.images)} photo(s) of paper records. Extract the patients."})
    return _ask_json(anthropic_client, system=EXTRACT_SYSTEM, content=content, model_type=ExtractPatientsResponse, max_tokens=4000, usage=usage)


def transcribe(req: TranscribeRequest, *, openai_client, usage=None) -> str:
    audio = base64.b64decode(req.audio, validate=True)
    extension = "webm" if "webm" in req.mime_type else "ogg" if "ogg" in req.mime_type else "mp4" if "mp4" in req.mime_type else "wav"
    response = openai_client.audio.transcriptions.create(
        model=get_settings().transcribe_model,
        file=(f"consultation.{extension}", audio, req.mime_type),
        # Primes spelling of drug names and local terms; the previous segment keeps sentences joined.
        prompt=f"Medical consultation at a Nigerian hospital. {req.previous_text[-400:]}".strip(),
    )
    if usage is not None:
        usage.add_audio(req.seconds)
    return (getattr(response, "text", None) or "").strip()


def scribe_note(req: ScribeNoteRequest, *, anthropic_client, usage=None) -> ScribeNoteOutput:
    codes = {f.id for f in req.findings}
    catalog = "\n".join(f"{f.id}: {f.label}" for f in req.findings)
    message = (
        "PATIENT RECORD (de-identified)\n"
        f"{json.dumps(req.emr_snapshot.model_dump(exclude_none=True), indent=2, default=str)}\n\n"
        f"FINDING CODES\n{catalog}\n\n"
        f"CONSULTATION TRANSCRIPT\n{req.transcript}"
    )
    output = _ask_json(anthropic_client, system=SCRIBE_SYSTEM, content=message, model_type=ScribeNoteOutput, max_tokens=3000, usage=usage)
    # Only codes we offered are kept (the database engine ignores anything else anyway).
    output.findings_present = [c for c in dict.fromkeys(output.findings_present) if c in codes]
    output.findings_absent = [c for c in dict.fromkeys(output.findings_absent) if c in codes and c not in output.findings_present]
    output.possible_diagnoses = output.possible_diagnoses[:5]
    return output
