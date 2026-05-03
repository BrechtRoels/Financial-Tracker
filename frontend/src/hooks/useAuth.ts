import { useQuery } from "@tanstack/react-query";
import { api, getToken, setToken } from "../api/client";

export type Me = {
  id: number;
  email: string;
  is_admin: boolean;
  ai_enabled: boolean;
  created_at: string;
};

export function useMe() {
  return useQuery<Me>({
    queryKey: ["me"],
    queryFn: async () => (await api.get("/auth/me")).data,
    enabled: !!getToken(),
    retry: false,
    staleTime: 60_000,
  });
}

export async function loginRequest(email: string, password: string) {
  const form = new URLSearchParams();
  form.set("username", email);
  form.set("password", password);
  const { data } = await api.post("/auth/login", form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  setToken(data.access_token);
}

export async function setupRequest(email: string, password: string) {
  const { data } = await api.post("/auth/setup", { email, password });
  setToken(data.access_token);
}

export async function setupRequired(): Promise<boolean> {
  const { data } = await api.get("/auth/setup-required");
  return data.setup_required;
}

export function logout() {
  setToken(null);
  location.href = "/login";
}
