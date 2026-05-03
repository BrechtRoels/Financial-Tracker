import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

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
