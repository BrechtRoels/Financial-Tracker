import { api } from "./client";

export type ScanReceiptOut = {
  total_amount_cents: number | null;
  currency: string | null;
  occurred_on: string | null;
  merchant: string | null;
  description: string | null;
  category_id: number | null;
  confidence: number | null;
  error: string | null;
};

export async function scanReceipt(file: File): Promise<ScanReceiptOut> {
  const fd = new FormData();
  fd.append("file", file);
  const resp = await api.post("/transactions/scan-receipt", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return resp.data as ScanReceiptOut;
}
