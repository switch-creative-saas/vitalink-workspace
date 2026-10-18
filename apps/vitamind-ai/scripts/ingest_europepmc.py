"""Fill vitamind_knowledge with recent reviews and guidelines from Europe PMC.

For every condition in VitaMind Dx's knowledge base (dx_conditions), fetch the
most relevant recent reviews/guidelines (abstracts; full text is not needed for
retrieval), chunk and embed them. Safe to re-run: chunks are upserted by
(source_url, chunk_index).

    python -m scripts.ingest_europepmc            # all conditions, 15 papers each
    python -m scripts.ingest_europepmc malaria tb # only these conditions
"""
import re
import sys
import time
from datetime import date

import httpx

from app import knowledge
from app.clients import get_openai, get_supabase

EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
PER_CONDITION = 15


def fetch(query: str) -> list[dict]:
    since = date.today().year - 10
    q = (
        f'({query}) AND (PUB_TYPE:"review" OR PUB_TYPE:"practice guideline" OR PUB_TYPE:"guideline") '
        f"AND HAS_ABSTRACT:y AND FIRST_PDATE:[{since}-01-01 TO 3000-12-31]"
    )
    response = httpx.get(EPMC, params={"query": q, "format": "json", "pageSize": PER_CONDITION, "resultType": "core"}, timeout=60)
    response.raise_for_status()
    return response.json().get("resultList", {}).get("result", [])


def main(only: list[str]) -> None:
    supabase, openai_client = get_supabase(), get_openai()
    conditions = supabase.table("dx_conditions").select("id, name, pubmed_query").execute().data
    for condition in conditions:
        if only and condition["id"] not in only:
            continue
        query = re.sub(r"\[[^\]]+\]", "", condition["pubmed_query"])
        papers = fetch(query)
        stored = 0
        for paper in papers:
            abstract = re.sub(r"<[^>]+>", " ", paper.get("abstractText") or "").strip()
            if len(abstract) < 200:
                continue
            types = " ".join(paper.get("pubTypeList", {}).get("pubType", [])).lower()
            url = f"https://europepmc.org/article/{paper.get('source', 'MED')}/{paper['id']}"
            title = re.sub(r"<[^>]+>", "", paper.get("title", "")).strip()
            journal = paper.get("journalInfo", {}).get("journal", {}).get("title", "")
            text = f"{title}\n{journal} ({paper.get('pubYear', '')})\n\n{abstract}"
            knowledge.store(
                supabase, openai_client, text=text, source_url=url, title=title,
                source_type="guideline" if "guideline" in types else "pubmed",
            )
            stored += 1
        print(f"{condition['name']}: {stored} papers")
        time.sleep(0.5)  # be polite to Europe PMC


if __name__ == "__main__":
    main(sys.argv[1:])
