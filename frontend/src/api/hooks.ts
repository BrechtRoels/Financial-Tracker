import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { listGoals, listLocations, listRecurring } from "./goals";
import { listHoldings } from "./investments";
import type { Account, Anomaly, Budget, BucketBreakdown, Category, Holding, Insight, LocationItem, MerchantSummary, MonthlySpending, NetWorthForecast, NetWorthPoint, RecurringItem, RunwayOut, SavingsGoal, SpendingByCategory, Summary, Transaction } from "./types";

export const useAccounts = () =>
  useQuery<Account[]>({ queryKey: ["accounts"], queryFn: async () => (await api.get("/accounts")).data });

export const useCategories = () =>
  useQuery<Category[]>({ queryKey: ["categories"], queryFn: async () => (await api.get("/categories")).data });

export function useTransactions(params: Record<string, string | number | undefined> = {}) {
  const qs = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ""));
  return useQuery<Transaction[]>({
    queryKey: ["transactions", qs],
    queryFn: async () => (await api.get("/transactions", { params: qs })).data,
  });
}

export const useBudgets = (month: string) =>
  useQuery<Budget[]>({
    queryKey: ["budgets", month],
    queryFn: async () => (await api.get("/budgets", { params: { month } })).data,
  });

export const useSummary = (month: string) =>
  useQuery<Summary>({
    queryKey: ["summary", month],
    queryFn: async () => (await api.get("/stats/summary", { params: { month } })).data,
  });

export const useNetWorth = (
  from: string,
  to: string,
  granularity: "daily" | "weekly" | "monthly" = "weekly"
) =>
  useQuery<NetWorthPoint[]>({
    queryKey: ["nw", from, to, granularity],
    queryFn: async () =>
      (await api.get("/stats/net-worth", { params: { from, to, granularity } })).data,
  });

export const useDataRange = () =>
  useQuery<{ earliest_transaction: string | null; latest_transaction: string | null }>({
    queryKey: ["data-range"],
    queryFn: async () => (await api.get("/stats/data-range")).data,
  });

export const useNetWorthForecast = (weeks = 26, enabled = true) =>
  useQuery<NetWorthForecast>({
    queryKey: ["nw-forecast", weeks],
    queryFn: async () =>
      (await api.get("/stats/net-worth/forecast", { params: { weeks } })).data,
    enabled,
  });

export const useCurrentNetWorth = () =>
  useQuery<{ assets_cents: number; liabilities_cents: number; net_worth_cents: number; date: string }>({
    queryKey: ["nw-current"],
    queryFn: async () => (await api.get("/stats/net-worth/current")).data,
  });

export const useHoldings = () =>
  useQuery<Holding[]>({
    queryKey: ["holdings"],
    queryFn: listHoldings,
    staleTime: 60_000,
  });

export const useGoals = () =>
  useQuery<SavingsGoal[]>({ queryKey: ["goals"], queryFn: listGoals });

export const useSpendingByMonth = (months = 12) =>
  useQuery<MonthlySpending[]>({
    queryKey: ["spending-by-month", months],
    queryFn: async () => (await api.get("/stats/spending-by-month", { params: { months } })).data,
  });

export const useMerchants = (months = 12) =>
  useQuery<MerchantSummary[]>({
    queryKey: ["merchants", months],
    queryFn: async () =>
      (await api.get("/stats/merchants", { params: { months } })).data,
  });

export const useRunway = () =>
  useQuery<RunwayOut>({
    queryKey: ["runway"],
    queryFn: async () => (await api.get("/stats/runway")).data,
    staleTime: 60_000,
  });

export const useBuckets = (month?: string) =>
  useQuery<BucketBreakdown>({
    queryKey: ["buckets", month ?? "current"],
    queryFn: async () =>
      (await api.get("/stats/buckets", { params: month ? { month } : undefined })).data,
    staleTime: 60_000,
  });

export const useAnomalies = () =>
  useQuery<Anomaly[]>({
    queryKey: ["anomalies"],
    queryFn: async () => (await api.get("/stats/anomalies")).data,
    staleTime: 60_000,
  });

export const useInsights = (month?: string) =>
  useQuery<Insight[]>({
    queryKey: ["insights", month ?? "current"],
    queryFn: async () =>
      (await api.get("/stats/insights", { params: month ? { month } : undefined })).data,
  });

export const useLocations = (lookback_days = 365) =>
  useQuery<LocationItem[]>({
    queryKey: ["locations", lookback_days],
    queryFn: () => listLocations({ lookback_days }),
  });

export const useRecurring = (includeIgnored = false) =>
  useQuery<RecurringItem[]>({
    queryKey: ["recurring", includeIgnored],
    queryFn: () => listRecurring({ lookback_days: 180, min_occurrences: 3, include_ignored: includeIgnored }),
  });

export const useSpendingByCategory = (from: string, to: string) =>
  useQuery<SpendingByCategory[]>({
    queryKey: ["spending", from, to],
    queryFn: async () => (await api.get("/stats/spending-by-category", { params: { from, to } })).data,
  });

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => {
    keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    qc.invalidateQueries({ queryKey: ["nw-current"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
  };
}

export function useMutateResource<T, TVars>(fn: (v: TVars) => Promise<T>, invalidate: string[]) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: fn, onSuccess: () => inv(...invalidate) });
}
