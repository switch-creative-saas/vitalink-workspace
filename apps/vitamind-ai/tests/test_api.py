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

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[CHUNK]))


class FakeOpenAI:
    def __init__(self):
        self.embeddings = SimpleNamespace(create=self._create)

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
    yield SimpleNamespace(db=db, llm=llm, client=TestClient(app))
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
    assert fakes.db.rpc_calls[0][0] == "vitamind_match_knowledge" and fakes.db.rpc_calls[0][1]["match_count"] == 3


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
