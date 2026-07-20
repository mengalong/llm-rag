#!/usr/bin/env python3
"""Check all model dependencies configured in .env are reachable."""
import sys
import httpx
import anthropic

# Load settings from the same .env as the app
from app.config import settings

OK = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"
WARN = "\033[33m!\033[0m"

results: list[tuple[bool, str]] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    tag = OK if ok else FAIL
    suffix = f"  ({detail})" if detail else ""
    print(f"  {tag}  {label}{suffix}")
    results.append((ok, label))


# ── 1. LLM ────────────────────────────────────────────────────────────────────
print("\n[LLM]")
print(f"     base_url : {settings.llm_base_url}")
print(f"     model    : {settings.llm_model}")

if not settings.llm_api_key:
    check("LLM_API_KEY set", False, "empty")
else:
    check("LLM_API_KEY set", True, f"{settings.llm_api_key[:6]}...")
    try:
        client = anthropic.Anthropic(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
        )
        msg = client.messages.create(
            model=settings.llm_model,
            max_tokens=16,
            messages=[{"role": "user", "content": "Reply with the single word: ok"}],
        )
        reply = msg.content[0].text.strip()
        check(f"LLM reachable ({settings.llm_model})", True, f"replied: {reply!r}")
    except Exception as e:
        check(f"LLM reachable ({settings.llm_model})", False, str(e)[:120])

# ── 2. Graph LLM (if different) ───────────────────────────────────────────────
if settings.graph_llm_model and settings.graph_llm_model != settings.llm_model:
    print("\n[Graph LLM]")
    print(f"     model    : {settings.graph_llm_model}")
    api_key = settings.effective_graph_llm_api_key
    try:
        client = anthropic.Anthropic(
            api_key=api_key,
            base_url=settings.llm_base_url,
        )
        msg = client.messages.create(
            model=settings.graph_llm_model,
            max_tokens=16,
            messages=[{"role": "user", "content": "Reply with the single word: ok"}],
        )
        reply = msg.content[0].text.strip()
        check(f"Graph LLM reachable ({settings.graph_llm_model})", True, f"replied: {reply!r}")
    except Exception as e:
        check(f"Graph LLM reachable ({settings.graph_llm_model})", False, str(e)[:120])
else:
    print("\n[Graph LLM]")
    print(f"     (reuses LLM model: {settings.llm_model})")

# ── 3. Embedding ──────────────────────────────────────────────────────────────
print("\n[Embedding]")
print(f"     backend  : {settings.embedding_backend}")
print(f"     model    : {settings.embedding_model}")

if settings.embedding_backend == "local":
    try:
        from sentence_transformers import SentenceTransformer
        m = SentenceTransformer(settings.embedding_model)
        vec = m.encode(["test"], convert_to_numpy=True)[0]
        check(f"Local embedding ({settings.embedding_model})", True, f"dim={len(vec)}")
    except Exception as e:
        check(f"Local embedding ({settings.embedding_model})", False, str(e)[:120])

elif settings.embedding_backend == "ollama":
    if not settings.embedding_base_url:
        check("EMBEDDING_BASE_URL set", False, "empty")
    else:
        base = settings.embedding_base_url.rstrip("/")
        url = f"{base}/api/embeddings" if not base.endswith("/api/embeddings") else base
        try:
            resp = httpx.post(
                url,
                json={"model": settings.embedding_model, "prompt": "test"},
                timeout=15.0,
            )
            resp.raise_for_status()
            vec = resp.json().get("embedding", [])
            check(f"Ollama embedding ({settings.embedding_model})", True, f"dim={len(vec)}")
        except Exception as e:
            check(f"Ollama embedding ({settings.embedding_model})", False, str(e)[:120])
else:
    print(f"  {WARN}  backend '{settings.embedding_backend}' not checked")

# ── Summary ───────────────────────────────────────────────────────────────────
print()
failed = [label for ok, label in results if not ok]
if failed:
    print(f"\033[31mFAILED\033[0m  {len(failed)}/{len(results)} checks failed:")
    for label in failed:
        print(f"  - {label}")
    sys.exit(1)
else:
    print(f"\033[32mAll {len(results)} checks passed.\033[0m")
