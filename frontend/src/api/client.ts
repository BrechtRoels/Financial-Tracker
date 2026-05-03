import axios from "axios";

// Dev:  Vite proxies /api → localhost:8000 (see vite.config.ts).
// Prod: Vercel `experimentalServices` exposes the backend at /_/backend.
// Override either default by setting VITE_API_BASE_URL.
const PROD_DEFAULT = "/_/backend";
const DEV_DEFAULT = "/api";
const RAW_BASE =
  import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? DEV_DEFAULT : PROD_DEFAULT);
export const API_BASE_URL = RAW_BASE.replace(/\/+$/, "");

export const api = axios.create({ baseURL: API_BASE_URL });

const TOKEN_KEY = "ft_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      setToken(null);
      if (!location.pathname.startsWith("/login") && !location.pathname.startsWith("/setup")) {
        location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);
