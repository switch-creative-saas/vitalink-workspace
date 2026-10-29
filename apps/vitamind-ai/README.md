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
| POST | `/extract-patients` | Up to 4 photos of paper records → Claude (vision) → patient details to review |
| POST | `/transcribe` | One consultation audio segment (~1 min) → OpenAI (`VITAMIND_TRANSCRIBE_MODEL`) → text |
| POST | `/scribe-note` | Consultation transcript + de-identified record → Claude → SOAP draft, symptom codes, things to consider |
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

## Spend protection

Paid calls are limited at two layers, so a leaked token or a runaway client can't run up a big bill:

| Where | Limit | Default |
| --- | --- | --- |
| Edge function `vitamind-diagnose` | per user | 3 a minute, 30 an hour |
| | per workspace | `VITAMIND_DAILY_LIMIT` a day (300) |
| | whole platform | `VITAMIND_GLOBAL_DAILY_LIMIT` a day (1000) |
| This service | all requests | `VITAMIND_MAX_REQUESTS_PER_MINUTE` (30) |
| | Claude, per day (UTC) | `VITAMIND_DAILY_LLM_REQUESTS` (1500) and `VITAMIND_DAILY_LLM_TOKENS` (3,000,000) |
| | OpenAI embeddings, per day | `VITAMIND_DAILY_EMBED_REQUESTS` (5000) and `VITAMIND_DAILY_EMBED_TOKENS` (5,000,000) |
| | OpenAI transcription, per day | `VITAMIND_DAILY_AUDIO_MINUTES` (1500 minutes) |
| | size | complaint 2,000 characters, EMR fields 20 KB each, request body 1 MB (photos 14 MB, audio 4.5 MB), `max_tokens` capped at 4000 |
| Edge function `vitamind-assist` | paper records | 60 photos an hour per person, 800 a day per workspace |
| | scribe | 90 minutes per consultation, 4 hours a day per doctor, 40 hours a day per workspace, 20 drafts an hour |

Token budgets are counted from the usage Anthropic and OpenAI report, in `public.ai_usage_daily`.
If the count can't be read, the service refuses rather than spending.

**Also set limits at the providers**, so even a stolen API key has a ceiling:

- Anthropic Console: Settings → Limits → monthly spend limit.
- OpenAI: Settings → Limits → budget, and use a project key restricted to embeddings.
- Keep these keys only in the service's environment, never in the apps.


## Plan

Workspaces get VitaMind AI when their plan includes the `vitamind-ai` module
(Enterprise by default). Add it to another plan by appending `vitamind-ai` to that
row's `modules` in `public.plans`.
