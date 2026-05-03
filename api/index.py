"""Vercel serverless entrypoint.

Vercel routes every `/api/*` request to this file (see ../vercel.json). We
expose the existing FastAPI app mounted under `/api` so its internal routes
(`/transactions`, `/chat/sessions/...`) line up with the URLs the frontend
calls (`/api/transactions`, etc).

Environment variables required on Vercel:
    DATABASE_URL    sqlite+libsql://<host>?authToken=<jwt>&secure=true
    SECRET_KEY      `openssl rand -hex 32`
    GENAI_API_KEY   PwC GenAI key
    MPLCONFIGDIR    /tmp/matplotlib   (matplotlib cache dir on serverless fs)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# matplotlib cache must be writable; only /tmp is on Vercel.
os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")

# Make the existing backend package importable from this entrypoint.
_BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(_BACKEND))

from fastapi import FastAPI  # noqa: E402

from app.main import app as inner_app  # noqa: E402

app = FastAPI()
app.mount("/api", inner_app)
