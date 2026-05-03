import { api } from "./client";
import type { Holding, HoldingUpsert, Quote } from "./types";

export async function listHoldings(): Promise<Holding[]> {
  return (await api.get("/investments/holdings")).data;
}

export async function createHolding(payload: HoldingUpsert): Promise<Holding> {
  return (await api.post("/investments/holdings", payload)).data;
}

export async function updateHolding(
  id: number,
  payload: Partial<HoldingUpsert>
): Promise<Holding> {
  return (await api.patch(`/investments/holdings/${id}`, payload)).data;
}

export async function deleteHolding(id: number): Promise<void> {
  await api.delete(`/investments/holdings/${id}`);
}

export async function getQuote(symbol: string): Promise<Quote> {
  return (await api.get(`/investments/quote/${encodeURIComponent(symbol)}`)).data;
}
