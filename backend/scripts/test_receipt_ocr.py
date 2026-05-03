"""Test which PwC GenAI model can OCR a receipt photo into structured fields.

Usage (from `backend/`, with the venv activated):

    python scripts/test_receipt_ocr.py path/to/receipt.jpg

Tries the available chat models in cost order (cheapest first) and prints,
for each one:

    - whether the call succeeded
    - the raw response text
    - whether it parses as the expected JSON shape
    - end-to-end latency

Goal: pick the cheapest model that reliably returns a parseable JSON object
with `total_amount`, `currency`, `date`, `merchant`. The implementation will
then call only that model.
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
import sys
import time
from pathlib import Path

# Make `app` importable when this script is run from the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from app.config import settings  # noqa: E402


# Cheapest first — proxy resolves these to OpenAI / Azure / Bedrock backends.
CANDIDATE_MODELS = [
    "openai.gpt-5.4-nano",
    "openai.gpt-5-nano",
    "openai.gpt-5.4-mini",
]

PROMPT = """You read a photo of a receipt and extract structured fields.

Return ONE JSON object — no prose, no markdown, no code fences — with:
- "total_amount": float — the final total paid, in the receipt's currency. Positive number.
- "currency": 3-letter ISO code ("EUR", "USD", "GBP"). Best guess from the receipt; default "EUR".
- "date": ISO YYYY-MM-DD if visible, else null.
- "merchant": short brand / shop name (e.g. "Albert Heijn", not the legal entity or address).
- "category_guess": one of "groceries", "restaurant", "transport", "shopping", "entertainment", "utilities", "health", "other" — your best guess from what was bought.
- "confidence": 0.0–1.0, how confident you are in `total_amount`.

If the image is unreadable or clearly not a receipt, return:
{"error": "not_a_receipt"}

Output strictly the JSON, nothing else.
"""


def _mime_for(path: Path) -> str:
    suffix = path.suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".heic": "image/heic",
    }.get(suffix, "image/jpeg")


def _data_url(path: Path) -> str:
    raw = path.read_bytes()
    return f"data:{_mime_for(path)};base64,{base64.b64encode(raw).decode()}"


async def _call_model(model: str, image_data_url: str) -> tuple[bool, float, str, dict | None]:
    """Returns (ok, elapsed_seconds, raw_text, parsed_json_or_none)."""
    headers = {"api-key": settings.genai_api_key, "Content-Type": "application/json"}
    params = {"api-version": settings.genai_api_version} if settings.genai_api_version else {}
    payload = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": PROMPT},
                    {"type": "input_image", "image_url": image_data_url},
                ],
            }
        ],
    }

    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{settings.genai_base_url}/v1/responses",
                headers=headers,
                params=params,
                json=payload,
            )
        elapsed = time.perf_counter() - start
        if resp.status_code != 200:
            return False, elapsed, f"HTTP {resp.status_code}: {resp.text[:300]}", None

        data = resp.json()
        text = ""
        for item in data.get("output", []):
            if item.get("type") == "message":
                for c in item.get("content", []):
                    if c.get("type") == "output_text":
                        text = c["text"]
                        break
        if not text and "choices" in data:
            text = data["choices"][0]["message"]["content"]

        parsed: dict | None = None
        try:
            cleaned = text.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.strip("`").strip()
                if cleaned.lower().startswith("json"):
                    cleaned = cleaned[4:].lstrip()
            m = re.search(r"\{[\s\S]*\}", cleaned)
            if m:
                cleaned = m.group(0)
            parsed = json.loads(cleaned)
        except Exception:
            parsed = None

        return True, elapsed, text, parsed
    except Exception as e:
        elapsed = time.perf_counter() - start
        return False, elapsed, f"{type(e).__name__}: {e}", None


async def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python scripts/test_receipt_ocr.py <image_path>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1]).resolve()
    if not path.exists():
        print(f"file not found: {path}", file=sys.stderr)
        return 2
    if not settings.genai_enabled:
        print("GENAI_API_KEY not set in backend/.env", file=sys.stderr)
        return 2

    print(f"Image: {path} ({path.stat().st_size / 1024:.1f} KB)")
    print(f"Trying models in cost order:\n")

    image_url = _data_url(path)

    for model in CANDIDATE_MODELS:
        print(f"━━ {model} ━━")
        ok, elapsed, text, parsed = await _call_model(model, image_url)
        print(f"  status: {'OK' if ok else 'FAIL'}   latency: {elapsed:.2f}s")
        if not ok:
            print(f"  error: {text}\n")
            continue
        print(f"  raw output:\n{text.strip()}\n")
        if parsed is None:
            print("  ✗ output did not parse as JSON\n")
            continue
        if "error" in parsed:
            print(f"  ✗ model says: {parsed['error']}\n")
            continue
        keys = {"total_amount", "currency", "date", "merchant"}
        missing = keys - parsed.keys()
        if missing:
            print(f"  ✗ missing keys: {missing}\n")
            continue
        print(f"  ✓ parsed: total={parsed.get('total_amount')} {parsed.get('currency')} "
              f"on {parsed.get('date')} at {parsed.get('merchant')!r} "
              f"(conf {parsed.get('confidence')})\n")

    print("Pick the cheapest model with a ✓ above and report back.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
