# Deployment guide — Vercel + Fly.io + Turso

This walks through deploying the Finance Tracker as:

- **Frontend** → Vercel (static Vite build)
- **Backend** → Fly.io (FastAPI in Docker)
- **Database** → Turso (libSQL — SQLite-compatible, network)

The backend code transparently supports either local SQLite (`sqlite:///./finance.db`) or Turso (`sqlite+libsql://…`) based on the `DATABASE_URL` env var, so nothing in the app changes between dev and prod.

## 1. Provision Turso

Install the CLI and create a DB:

```sh
brew install tursodatabase/tap/turso
turso auth signup            # or: turso auth login
turso db create financial-tracker
turso db show financial-tracker --url    # → libsql://<host>
turso db tokens create financial-tracker # → <JWT>
```

Build the SQLAlchemy URL (note `sqlite+libsql://` not `libsql://`):

```
sqlite+libsql://<host>?authToken=<JWT>&secure=true
```

## 2. Migrate local data → Turso

From `backend/`, with the venv activated:

```sh
SOURCE_URL="sqlite:///./finance.db" \
TARGET_URL="sqlite+libsql://<host>?authToken=<JWT>&secure=true" \
python scripts/migrate_to_turso.py
```

The script creates the schema on the target and copies every row verbatim (preserving IDs). It refuses to run if the target already has data; pass `--force` to wipe-and-reload.

Verify:

```sh
turso db shell financial-tracker "select count(*) from transactions;"
```

## 3. Deploy backend to Fly.io

```sh
brew install flyctl
fly auth signup           # or: fly auth login
cd backend
fly launch --no-deploy --copy-config --name financial-tracker --region ams
```

(Decline Postgres / Redis prompts — we're using Turso.)

Set secrets (these never appear in the image):

```sh
fly secrets set \
  DATABASE_URL="sqlite+libsql://<host>?authToken=<JWT>&secure=true" \
  SECRET_KEY="$(openssl rand -hex 32)" \
  GENAI_API_KEY="<your-pwc-genai-key>" \
  CORS_ORIGINS="https://<your-vercel-domain>.vercel.app"
```

Deploy:

```sh
fly deploy
```

Note the assigned URL (e.g. `https://financial-tracker.fly.dev`). Open it in a browser — `{"name":"Finance Tracker API",…}` confirms it's live.

## 4. Deploy frontend to Vercel

From the repo root:

```sh
npm i -g vercel
cd frontend
vercel link              # follow prompts; pick this directory as the root
vercel env add VITE_API_BASE_URL production
# value: https://financial-tracker.fly.dev
vercel --prod
```

Or via the dashboard:

1. *New Project* → import the GitHub repo.
2. Set **Root Directory** to `frontend/`.
3. Framework preset: Vite (auto-detected).
4. Add env var `VITE_API_BASE_URL` = `https://financial-tracker.fly.dev`.
5. Deploy.

After it's live, copy the production domain (e.g. `https://financial-tracker.vercel.app`) and update Fly's CORS:

```sh
fly secrets set CORS_ORIGINS="https://financial-tracker.vercel.app"
```

(Fly redeploys automatically on secret change.)

## 5. Smoke-test

- Open the Vercel URL → log in with your existing email/password.
- Dashboard should load with all your accounts, transactions, holdings.
- Try `/transactions` CSV import — streaming progress should work (proves the non-axios `fetch` paths use the right base URL).
- Open `/chat` and send a message — streaming should work.

## Local dev — unchanged

Nothing about local dev changes:

```sh
# backend
cd backend && uvicorn app.main:app --reload
# frontend
cd frontend && npm run dev
```

Local frontend uses the Vite proxy at `/api` → `localhost:8000` because `VITE_API_BASE_URL` is not set in dev. Local backend reads `DATABASE_URL` from `backend/.env` (or defaults to `sqlite:///./finance.db`).

## Rollback

If anything breaks:

- Frontend: `vercel rollback` (or redeploy a previous commit).
- Backend: `fly releases` then `fly deploy --image <previous-image>`.
- DB: Turso has automatic backups; restore via `turso db restore`.

Your local `backend/finance.db` remains untouched throughout the migration — it's still the source of truth until you decide otherwise.
