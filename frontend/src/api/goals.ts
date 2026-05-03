import { api } from "./client";
import type { GoalUpsert, RecurringClassification, RecurringItem, SavingsGoal } from "./types";

export async function listGoals(): Promise<SavingsGoal[]> {
  return (await api.get("/goals")).data;
}
export async function createGoal(payload: GoalUpsert): Promise<SavingsGoal> {
  return (await api.post("/goals", payload)).data;
}
export async function updateGoal(id: number, payload: Partial<GoalUpsert>): Promise<SavingsGoal> {
  return (await api.patch(`/goals/${id}`, payload)).data;
}
export async function deleteGoal(id: number): Promise<void> {
  await api.delete(`/goals/${id}`);
}

export async function listRecurring(params: { lookback_days?: number; min_occurrences?: number; include_ignored?: boolean } = {}): Promise<RecurringItem[]> {
  return (await api.get("/stats/recurring", { params })).data;
}

export async function listLocations(params: { lookback_days?: number } = {}) {
  const resp = await api.get("/stats/locations", { params });
  return resp.data as import("./types").LocationItem[];
}

export async function classifyRecurring(
  key: string,
  classification: RecurringClassification | null
): Promise<void> {
  await api.post("/stats/recurring/classify", { key, classification });
}
