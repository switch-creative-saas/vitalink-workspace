# VitaMind AI service

The paid tier of VitaLink's clinical decision support. A Python FastAPI service that
retrieves relevant guideline and literature excerpts (pgvector in Supabase), asks
Claude for a structured differential, keeps only citations that match retrieved
sources, and logs results and clinician feedback.

VitaMind Dx (the included tier) runs entirely in the database and needs none of this.

```
Browser ─▶ Supabase edge function vitamind-diagnose ─▶ this service ─▶ Claude / OpenAI embeddings
              (auth, plan check, EMR snapshot,          (X-VitaMind-Token)      │
               session row, daily limit)                                         ▼
                                                                   Supabase: vitamind_* tables
```

## Endpoints (all need the `X-VitaMind-Token` header)

| Method | Path | Does |
| --- | --- | --- |
| POST | `/embed` | Chunk text, embed (text-embedding-3-small), upsert into `vitamind_knowledge` |
| POST | `/search` | Top-k chunks by cosine similarity (`vitamind_match_knowledge`) |
| POST | `/diagnose` | Retrieve 5 chunks → Claude → validated JSON → `vitamind_results` |
| POST | `/feedback` | Clinician confirm / override / partial → `vitamind_feedback` |
| GET | `/health` | Which keys are configured (no auth) |

Patient data sent to the model is de-identified: no name, phone, address or VitaLink ID.

## Run locally

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt   # macOS/Linux: .venv/bin/pip
cp .env.example .env                                 # fill in the keys
.venv/Scripts/uvicorn app.main:app --reload --port 8000
.venv/Scripts/pytest -q                              # tests use fakes, no keys needed
```

## Fill the knowledge base

```bash
.venv/Scripts/python -m scripts.ingest_europepmc            # every VitaMind Dx condition
.venv/Scripts/python -m scripts.ingest_europepmc malaria tb # just these
```

Add FMOH / NCDC guideline text with `POST /embed` and `source_type: "fmoh"`.

## Deploy

Any container host works (Render, Railway, Fly.io, Cloud Run): build the `Dockerfile`,
set the variables from `.env.example`, expose port 8000 (`PORT` is honoured).

Then set these secrets on the Supabase project so the edge function can reach it:

```bash
supabase secrets set VITAMIND_AI_URL=https://your-service.example.com VITAMIND_SERVICE_TOKEN=<same token>
```

Optional: `VITAMIND_DAILY_LIMIT` (analyses per workspace per day, default 300).

## Plan

Workspaces get VitaMind AI when their plan includes the `vitamind-ai` module
(Enterprise by default). Add it to another plan by appending `vitamind-ai` to that
row's `modules` in `public.plans`.
