#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d backend/.venv ]; then
  echo "→ creating backend venv"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q --upgrade pip
  backend/.venv/bin/pip install -q -e backend
fi

if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
fi

if [ ! -d frontend/node_modules ]; then
  echo "→ installing frontend deps"
  (cd frontend && npm install --silent)
fi

cleanup() { kill 0; }
trap cleanup SIGINT SIGTERM EXIT

(cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000) &
(cd frontend && npm run dev) &
wait
