import { api } from "./client";

export type AdminModelOption = {
  id: string;
  label: string;
  hint: string;
};

export type AdminSettings = {
  chat_model: string;
  llm_model: string;
  vision_model: string;
  available_models: AdminModelOption[];
};

export type AdminUser = {
  id: number;
  email: string;
  is_admin: boolean;
  ai_enabled: boolean;
  created_at: string;
};

export async function fetchAdminSettings(): Promise<AdminSettings> {
  const r = await api.get("/admin/settings");
  return r.data;
}

export async function updateAdminSettings(
  patch: Partial<Pick<AdminSettings, "chat_model" | "llm_model" | "vision_model">>
): Promise<AdminSettings> {
  const r = await api.patch("/admin/settings", patch);
  return r.data;
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const r = await api.get("/admin/users");
  return r.data;
}

export async function updateAdminUser(
  id: number,
  patch: { ai_enabled?: boolean }
): Promise<AdminUser> {
  const r = await api.patch(`/admin/users/${id}`, patch);
  return r.data;
}
