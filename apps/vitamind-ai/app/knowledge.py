"""Chunking, embeddings and vector search over vitamind_knowledge."""
import re

from .config import get_settings
from .schemas import KnowledgeChunk

CHUNK_CHARS = 1500
OVERLAP_CHARS = 200


def chunk_text(text: str, size: int = CHUNK_CHARS, overlap: int = OVERLAP_CHARS) -> list[str]:
    """Split on paragraph/sentence boundaries into ~size-character chunks with overlap."""
    text = re.sub(r"[ \t]+", " ", text).strip()
    if len(text) <= size:
        return [text]
    sentences = re.split(r"(?<=[.!?])\s+|\n{2,}", text)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if current and len(current) + len(sentence) + 1 > size:
            chunks.append(current.strip())
            current = current[-overlap:] + " " + sentence
        else:
            current = f"{current} {sentence}" if current else sentence
    if current.strip():
        chunks.append(current.strip())
    return chunks


def embed(openai_client, texts: list[str], usage=None) -> list[list[float]]:
    response = openai_client.embeddings.create(model=get_settings().embedding_model, input=texts)
    if usage is not None:
        usage.add_embed(response)
    return [item.embedding for item in response.data]


def store(supabase, openai_client, *, text: str, source_url: str, title: str, source_type: str, usage=None) -> list[str]:
    chunks = chunk_text(text)
    vectors = embed(openai_client, chunks, usage)
    rows = [
        {"source_url": source_url, "title": title, "chunk_index": i, "chunk_text": chunk, "embedding": vector, "source_type": source_type}
        for i, (chunk, vector) in enumerate(zip(chunks, vectors))
    ]
    result = supabase.table("vitamind_knowledge").upsert(rows, on_conflict="source_url,chunk_index").execute()
    return [row["id"] for row in (result.data or [])]


def search(supabase, openai_client, query: str, top_k: int = 5, min_similarity: float = 0.2, usage=None) -> list[KnowledgeChunk]:
    [vector] = embed(openai_client, [query], usage)
    result = supabase.rpc(
        "vitamind_match_knowledge", {"query_embedding": vector, "match_count": top_k, "min_similarity": min_similarity}
    ).execute()
    return [KnowledgeChunk(**{**row, "id": str(row["id"])}) for row in (result.data or [])]
