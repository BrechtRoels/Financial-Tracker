export type Account = {
  id: number;
  name: string;
  type: string;
  iban: string | null;
  logo_url: string | null;
  opening_balance_cents: number;
  archived: boolean;
  is_asset: boolean;
  balance_cents: number;
  holdings_value_cents: number;
};

export type Holding = {
  id: number;
  account_id: number;
  symbol: string;
  name: string | null;
  shares: number;
  cost_basis_cents: number;
  notes: string | null;
  last_price: number | null;
  last_currency: string | null;
  last_price_at: string | null;
  market_value_cents: number;
  unrealised_pnl_cents: number;
  unrealised_pnl_pct: number | null;
};

export type HoldingUpsert = {
  account_id: number;
  symbol: string;
  shares: number;
  cost_basis_cents: number;
  notes?: string | null;
};

export type Quote = {
  symbol: string;
  price: number;
  currency: string;
  exchange?: string | null;
  long_name?: string | null;
};

export type Category = {
  id: number;
  name: string;
  kind: "income" | "expense";
  color: string;
  icon: string | null;
};

export type Transaction = {
  id: number;
  account_id: number;
  category_id: number | null;
  amount_cents: number;
  occurred_on: string;
  description: string;
  transfer_group_id: string | null;
  counterparty_iban: string | null;
  counterparty_name: string | null;
  merchant: string | null;
  refund_for_id: number | null;
};

export type RefundCandidate = {
  id: number;
  occurred_on: string;
  amount_cents: number;
  merchant: string | null;
  description: string;
  account_id: number;
  category_id: number | null;
  days_apart: number;
};

export type Budget = {
  id: number;
  category_id: number;
  month: string;
  amount_cents: number;
  spent_cents: number;
};

export type Summary = {
  month: string;
  income_cents: number;
  expenses_cents: number;
  net_cents: number;
  savings_rate: number;
  top_categories: { id: number; name: string; color: string; amount_cents: number }[];
  avg_monthly_expenses_cents: number;
  months_sampled: number;
};

export type NetWorthPoint = {
  date: string;
  assets_cents: number;
  liabilities_cents: number;
  net_worth_cents: number;
};

export type NetWorthForecastPoint = {
  date: string;
  point_cents: number;
  lower_cents: number;
  upper_cents: number;
};

export type NetWorthForecastParams = {
  method: "damped_holt";
  alpha: number;
  beta: number;
  phi: number;
  sigma_cents: number;
  rmse_cents: number;
  weekly_drag_cents: number;
  weeks_used: number;
};

export type NetWorthForecast = {
  history: NetWorthPoint[];
  forecast: NetWorthForecastPoint[];
  params: NetWorthForecastParams;
};

export type SpendingByCategory = {
  category_id: number | null;
  category_name: string;
  color: string;
  amount_cents: number;
};

export type RecurringClassification = "subscription" | "regular" | "ignore";

export type RecurringItem = {
  key: string;
  label: string;
  cadence: "weekly" | "monthly" | "yearly";
  classification: RecurringClassification;
  is_user_set: boolean;
  count: number;
  avg_amount_cents: number;
  monthly_equivalent_cents: number;
  last_seen: string;
  next_expected: string;
};

export type MonthlySpending = {
  month: string; // YYYY-MM
  income_cents: number;
  expenses_cents: number;
  net_cents: number;
  top_category: { name: string; amount_cents: number } | null;
};

export type Severity = "good" | "neutral" | "warn" | "danger";

export type Insight = {
  kind: string;
  severity: "good" | "neutral" | "warn";
  headline: string;
  message: string;
  value: number | null;
};

export type AccountRunway = {
  account_id: number;
  name: string;
  type: string;
  logo_url: string | null;
  balance_cents: number;
  runway_months: number | null;
};

export type RunwayOut = {
  median_monthly_expense_cents: number;
  months_sampled: number;
  total_liquid_cents: number;
  total_runway_months: number | null;
  accounts: AccountRunway[];
  severity: Severity;
};

export type Anomaly = {
  kind: "category_zscore" | "new_merchant_large" | "recurring_jump" | "refund_candidate";
  severity: Severity;
  headline: string;
  message: string;
  transaction_id: number | null;
  occurred_on: string | null;
  value: number | null;
};

export type MerchantMonthly = { month: string; amount_cents: number };

export type MerchantSummary = {
  merchant: string;
  total_cents: number;
  transactions: number;
  avg_cents: number;
  first_seen: string;
  last_seen: string;
  top_category: string | null;
  monthly: MerchantMonthly[];
};

export type LocationItem = {
  city: string;
  country: string | null;
  label: string;
  count: number;
  total_spent_cents: number;
  last_visit: string;
  lat: number | null;
  lon: number | null;
};

export type SavingsGoal = {
  id: number;
  name: string;
  target_cents: number;
  target_date: string | null;
  account_id: number | null;
  archived: boolean;
  current_cents: number;
  progress_pct: number;
  monthly_rate_cents: number;
  required_monthly_cents: number | null;
  eta_date: string | null;
  on_track: boolean;
  status_reason: string | null;
};

export type GoalUpsert = {
  name: string;
  target_cents: number;
  target_date?: string | null;
  account_id?: number | null;
};

export const ACCOUNT_TYPES = [
  { value: "cash", label: "Cash" },
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "investment", label: "Investment" },
  { value: "meal_vouchers", label: "Meal vouchers" },
  { value: "credit_card", label: "Credit Card" },
  { value: "loan", label: "Loan" },
  { value: "other", label: "Other" },
];
