from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import Base, engine, ensure_schema
from .routers import accounts, auth, budgets, categories, chat, goals, investments, stats, transactions

Base.metadata.create_all(bind=engine)
ensure_schema()

app = FastAPI(title="Finance Tracker", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(categories.router)
app.include_router(transactions.router)
app.include_router(budgets.router)
app.include_router(stats.router)
app.include_router(goals.router)
app.include_router(investments.router)
app.include_router(chat.router)


@app.get("/")
def root():
    return {"name": "Finance Tracker API", "version": "0.1.0"}
