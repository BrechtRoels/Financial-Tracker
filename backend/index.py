"""Vercel service entrypoint for the FastAPI backend.

When Vercel's `experimentalServices` deploys this directory as the `backend`
service with `routePrefix: "/_/backend"`, requests like `/_/backend/transactions`
are forwarded to this service. Vercel strips the prefix before delivering the
request, so FastAPI's existing routes (`/transactions`, `/chat/...`) match
without modification.

Local dev is unchanged — keep using `uvicorn app.main:app --reload`.
"""

import os

# matplotlib needs a writable cache dir; only /tmp is writable on Vercel.
os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")

from app.main import app  # noqa: E402, F401  — Vercel discovers `app`.
