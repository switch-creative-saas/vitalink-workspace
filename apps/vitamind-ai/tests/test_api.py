"""API tests with fake Supabase, OpenAI and Anthropic clients (no network, no keys)."""
import json
import os
from types import SimpleNamespace

import pytest

os.environ["VITAMIND_SERVICE_TOKEN"] = "test-token"
os.environ["VITAMIND_MODEL"] = "claude-test"

from fastapi.testclient import TestClient  # noqa: E402

from app import clients  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.diagnose import extract_json, keep_real_citations  # noqa: E402
from app.knowledge import chunk_text  # noqa: E402
from app.main import app  # noqa: E402
from app.prompt import SYSTEM_PROMPT  # noqa: E402
from app.schemas import Citation, KnowledgeChunk  # noqa: E402

get_settings.cache_clear()
AUTH = {"X-VitaMind-Token": "test-token"}

CHUNK = {
    "id": "11111111-1111-1111-1111-111111111111", "title": "WHO guidelines for malaria",
    "source_url": "https://europepmc.org/article/MED/1", "source_type": "guideline",
    "chunk_text": "Confirm malaria with RDT or microscopy before treatment with an ACT.", "similarity": 0.82,
}


class FakeQuery:
    def __init__(self, db, table):
        self.db, self.table, self.rows = db, table, None

    def insert(self, rows):
        self.rows = rows if isinstance(rows, list) else [rows]
        return self

    def upsert(self, rows, on_conflict=None):
        return self.insert(rows)

    def execute(self):
        saved = [{**row, "id": f"{self.table}-{i}"} for i, row in enumerate(self.rows)]
        self.db.saved.setdefault(self.table, []).extend(saved)
        return SimpleNamespace(data=saved)


class FakeSupabase:
    def __init__(self):
        self.saved: dict[str, list] = {}
        self.rpc_calls: list = []
        self.usage_today = {"requests": 0, "tokens": 0}

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        if name == "ai_usage_today":
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=self.usage_today))
        if name == "ai_usage_add":
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=None))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[CHUNK]))


class FakeOpenAI:
    def __init__(self):
        self.embeddings = SimpleNamespace(create=self._create)
        self.audio_calls = []
        self.audio = SimpleNamespace(transcriptions=SimpleNamespace(create=self._transcribe))

    def _transcribe(self, **kwargs):
        self.audio_calls.append(kwargs)
        return SimpleNamespace(text=" Doctor, I have had fever and chills for three days. ")

    def _create(self, model, input):
        return SimpleNamespace(data=[SimpleNamespace(embedding=[0.1] * 1536) for _ in input])


class FakeAnthropic:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=self.replies.pop(0))])


GOOD_REPLY = json.dumps({
    "differential": [
        {"condition": "Malaria", "probability": "high", "supporting_evidence": ["fever", "chills"], "against_evidence": []},
        {"condition": "Typhoid fever", "probability": "low", "supporting_evidence": ["fever"], "against_evidence": ["no abdominal pain"]},
    ],
    "confidence_score": 0.78,
    "red_flags": [],
    "recommended_actions": ["Malaria RDT"],
    "citations": [
        {"title": "WHO guidelines for malaria", "source": "https://europepmc.org/article/MED/1"},
        {"title": "A paper the model invented", "source": "https://example.com/fake"},
    ],
    "requires_urgent_review": False,
    "disclaimer": "x",
})


@pytest.fixture
def fakes():
    db, oa = FakeSupabase(), FakeOpenAI()
    llm = FakeAnthropic([GOOD_REPLY])
    app.dependency_overrides[clients.get_supabase] = lambda: db
    app.dependency_overrides[clients.get_openai] = lambda: oa
    app.dependency_overrides[clients.get_anthropic] = lambda: llm
    yield SimpleNamespace(db=db, llm=llm, oa=oa, client=TestClient(app))
    app.dependency_overrides.clear()


def test_requires_service_token(fakes):
    assert fakes.client.post("/search", json={"query": "fever"}).status_code == 401
    assert fakes.client.post("/search", json={"query": "fever"}, headers={"X-VitaMind-Token": "wrong"}).status_code == 401


def test_embed_chunks_and_stores(fakes):
    text = "Malaria is common. " * 200
    r = fakes.client.post("/embed", headers=AUTH, json={"text": text, "source_url": "https://x", "title": "Malaria", "source_type": "pubmed"})
    assert r.status_code == 200 and r.json()["chunks"] > 1
    rows = fakes.db.saved["vitamind_knowledge"]
    assert [row["chunk_index"] for row in rows] == list(range(len(rows)))
    assert len(rows[0]["embedding"]) == 1536


def test_search_returns_chunks(fakes):
    r = fakes.client.post("/search", headers=AUTH, json={"query": "fever and chills", "top_k": 3})
    assert r.status_code == 200 and r.json()[0]["title"] == CHUNK["title"]
    [match] = [params for name, params in fakes.db.rpc_calls if name == "vitamind_match_knowledge"]
    assert match["match_count"] == 3


def test_daily_budget_blocks_paid_calls(fakes):
    fakes.db.usage_today = {"requests": 10**9, "tokens": 0}
    r = fakes.client.post("/search", headers=AUTH, json={"query": "fever"})
    assert r.status_code == 429
    assert not [name for name, _ in fakes.db.rpc_calls if name == "vitamind_match_knowledge"]


def test_usage_is_recorded(fakes):
    fakes.client.post("/search", headers=AUTH, json={"query": "fever"})
    assert ("ai_usage_add", {"p_kind": "embed", "p_requests": 1, "p_tokens": 0}) in fakes.db.rpc_calls


def test_rejects_oversized_input(fakes):
    r = fakes.client.post("/diagnose", headers=AUTH, json={"session_id": "s", "chief_complaint": "x" * 2001})
    assert r.status_code == 422
    big = fakes.client.post("/embed", headers={**AUTH, "content-length": "5000000"}, content=b"{}")
    assert big.status_code == 413


def test_per_minute_rate_limit(fakes, monkeypatch):
    from app import limits
    monkeypatch.setattr(limits, "_recent", limits.deque())
    statuses = []
    original = get_settings().max_requests_per_minute
    try:
        object.__setattr__(get_settings(), "max_requests_per_minute", 2)
        for _ in range(3):
            statuses.append(fakes.client.post("/search", headers=AUTH, json={"query": "fever"}).status_code)
    finally:
        object.__setattr__(get_settings(), "max_requests_per_minute", original)
    assert statuses == [200, 200, 429]


def test_diagnose_end_to_end(fakes):
    body = {
        "session_id": "s-1", "chief_complaint": "Fever and chills for 3 days",
        "emr_snapshot": {"age": 30, "sex": "male", "allergies": ["penicillin"], "vitals": [{"temperature": 38.9}]},
    }
    r = fakes.client.post("/diagnose", headers=AUTH, json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["differential"][0]["condition"] == "Malaria"
    # the invented citation is dropped; only the retrieved source remains
    assert data["citations"] == [{"title": "WHO guidelines for malaria", "source": "https://europepmc.org/article/MED/1"}]
    assert data["disclaimer"].startswith("This output is for clinical decision support only")
    call = fakes.llm.calls[0]
    assert call["system"] == SYSTEM_PROMPT and call["model"] == "claude-test"
    assert "WHO guidelines for malaria" in call["messages"][0]["content"]
    saved = fakes.db.saved["vitamind_results"][0]
    assert saved["session_id"] == "s-1" and saved["model_used"] == "claude-test" and saved["raw_response"] == GOOD_REPLY
    assert data["result_id"] == saved["id"]


def test_diagnose_retries_once_on_bad_json(fakes):
    fakes.llm.replies = ["Sorry, here is my answer: not json", GOOD_REPLY]
    r = fakes.client.post("/diagnose", headers=AUTH, json={"session_id": "s-2", "chief_complaint": "fever"})
    assert r.status_code == 200 and len(fakes.llm.calls) == 2


def test_diagnose_gives_up_after_retry(fakes):
    fakes.llm.replies = ["nope", "still nope"]
    r = fakes.client.post("/diagnose", headers=AUTH, json={"session_id": "s-3", "chief_complaint": "fever"})
    assert r.status_code == 502 and "vitamind_results" not in fakes.db.saved


def test_feedback(fakes):
    r = fakes.client.post("/feedback", headers=AUTH, json={"result_id": "r-1", "clinician_id": "u-1", "action": "override"})
    assert r.status_code == 422
    r = fakes.client.post("/feedback", headers=AUTH, json={"result_id": "r-1", "clinician_id": "u-1", "action": "override", "actual_diagnosis": "Typhoid fever"})
    assert r.status_code == 200 and fakes.db.saved["vitamind_feedback"][0]["actual_diagnosis"] == "Typhoid fever"


def test_helpers():
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Here you go {"a": 2} thanks') == {"a": 2}
    chunks = chunk_text("Sentence one. " * 300, size=500, overlap=50)
    assert all(len(c) <= 600 for c in chunks) and len(chunks) > 3
    kept = keep_real_citations(
        [Citation(title="who guidelines for MALARIA", source="unknown"), Citation(title="Made up", source="https://nope")],
        [KnowledgeChunk(**CHUNK)],
    )
    assert [c.source for c in kept] == [CHUNK["source_url"]]


# ---------- paper records and the consultation scribe ----------

IMAGE = {"media_type": "image/jpeg", "data": "A" * 400}
EXTRACT_REPLY = json.dumps({
    "document_type": "register_page",
    "patients": [
        {"first_name": "Amaka", "last_name": "Obi", "age_years": 34, "gender": "female", "phone": "08031234567", "confidence": "high"},
        {"first_name": "Tunde", "last_name": "Bakare", "date_of_birth": "1990-04-12", "confidence": "low", "unclear_fields": ["phone"]},
    ],
    "notes": "Bottom row is torn.",
})
SCRIBE_REPLY = json.dumps({
    "chief_complaint": "Fever and chills for three days",
    "history_of_present_illness": "Patient reports fever and chills for three days.",
    "findings_present": ["fever", "chills", "made_up_code"],
    "findings_absent": ["fever", "cough"],
    "possible_diagnoses": [{"condition": "Malaria", "likelihood": "high", "why": "fever with chills"}],
})


def test_extract_patients_sends_images_to_claude(fakes):
    fakes.llm.replies = [EXTRACT_REPLY]
    r = fakes.client.post("/extract-patients", headers=AUTH, json={"images": [IMAGE, IMAGE]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert [p["last_name"] for p in data["patients"]] == ["Obi", "Bakare"]
    content = fakes.llm.calls[0]["messages"][0]["content"]
    assert [block["type"] for block in content] == ["image", "image", "text"]
    assert ("ai_usage_add", {"p_kind": "llm", "p_requests": 1, "p_tokens": 0}) in fakes.db.rpc_calls


def test_extract_patients_limits(fakes):
    assert fakes.client.post("/extract-patients", headers=AUTH, json={"images": [IMAGE] * 5}).status_code == 422
    assert fakes.client.post("/extract-patients", headers=AUTH, json={"images": [{"media_type": "application/pdf", "data": "A" * 400}]}).status_code == 422
    fakes.db.usage_today = {"requests": 10**9, "tokens": 0}
    assert fakes.client.post("/extract-patients", headers=AUTH, json={"images": [IMAGE]}).status_code == 429
    assert not fakes.llm.calls


def test_transcribe_counts_audio_seconds(fakes):
    import base64
    audio = base64.b64encode(b"webm-audio" + b"0" * 200).decode()
    r = fakes.client.post("/transcribe", headers=AUTH, json={"audio": audio, "mime_type": "audio/webm;codecs=opus", "seconds": 45, "previous_text": "Good morning."})
    assert r.status_code == 200 and r.json()["text"] == "Doctor, I have had fever and chills for three days."
    call = fakes.oa.audio_calls[0]
    assert call["file"][0] == "consultation.webm" and "Good morning." in call["prompt"]
    assert ("ai_usage_add", {"p_kind": "audio", "p_requests": 1, "p_tokens": 45}) in fakes.db.rpc_calls


def test_transcribe_rejects_bad_audio(fakes):
    r = fakes.client.post("/transcribe", headers=AUTH, json={"audio": "!" * 200, "seconds": 10})
    assert r.status_code == 422 and not fakes.oa.audio_calls


def test_scribe_note_keeps_only_offered_codes(fakes):
    fakes.llm.replies = [SCRIBE_REPLY]
    body = {
        "transcript": "Doctor: what brings you in? Patient: fever and chills for three days, no cough.",
        "emr_snapshot": {"age": 30, "sex": "female"},
        "findings": [{"id": "fever", "label": "Fever"}, {"id": "chills", "label": "Chills"}, {"id": "cough", "label": "Cough"}],
    }
    r = fakes.client.post("/scribe-note", headers=AUTH, json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["findings_present"] == ["fever", "chills"] and data["findings_absent"] == ["cough"]
    assert data["possible_diagnoses"][0]["condition"] == "Malaria"
    assert "fever: Fever" in fakes.llm.calls[0]["messages"][0]["content"]
