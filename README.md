# Finance Tracker

Personal finance tracker — single user, EUR, local-only. FastAPI + React + Tailwind (pastel).

## One-command start

```bash
./start.sh
```

Bootstraps the venv + node_modules on first run, then launches both servers. Ctrl+C stops both. Frontend at http://localhost:5173, backend at http://localhost:8000.

---

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e .
cp .env.example .env
uvicorn app.main:app --reload
```

API at http://localhost:8000 · OpenAPI docs at http://localhost:8000/docs

## Frontend

```bash
cd frontend
npm install
npm run dev
```

App at http://localhost:5173 (proxies `/api/*` to the backend).

## First run

1. Open http://localhost:5173
2. You'll be sent to the setup screen — create your single user.
3. Add accounts → add transactions → set budgets.
