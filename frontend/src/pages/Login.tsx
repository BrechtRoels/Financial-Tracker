import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loginRequest, setupRequired, setupRequest } from "../hooks/useAuth";

export default function Login() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "setup">("login");
  const [setupAllowed, setSetupAllowed] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setupRequired()
      .then((req) => {
        setSetupAllowed(req);
        setMode(req ? "setup" : "login");
      })
      .catch(() => setSetupAllowed(false));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (mode === "setup") await setupRequest(email, password);
      else await loginRequest(email, password);
      nav("/");
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const canToggle = setupAllowed === true || mode === "setup";

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm card">
        <div className="mb-6 text-center">
          <div className="text-xs font-medium text-subink uppercase tracking-widest">
            Finance Tracker
          </div>
          <h1 className="mt-2 text-xl font-semibold">
            {mode === "setup" ? "Welcome — let's set up" : "Welcome back"}
          </h1>
          <p className="text-sm text-subink">
            {mode === "setup"
              ? "Create your single user account to begin."
              : "Sign in to your finance tracker."}
          </p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div>
            <div className="label mb-1">{mode === "setup" ? "Email" : "Email or username"}</div>
            <input
              className="input"
              type={mode === "setup" ? "email" : "text"}
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <div className="label mb-1">Password</div>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          {err && <div className="text-xs text-neg">{err}</div>}
          <button className="btn-primary mt-2" disabled={loading}>
            {loading ? "…" : mode === "setup" ? "Create account" : "Sign in"}
          </button>
        </form>
        {canToggle && (
          <div className="mt-4 text-center text-sm text-subink">
            {mode === "setup" ? (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  className="text-brand-accent hover:underline font-medium"
                  onClick={() => {
                    setErr(null);
                    setMode("login");
                  }}
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                First time here?{" "}
                <button
                  type="button"
                  className="text-brand-accent hover:underline font-medium"
                  onClick={() => {
                    setErr(null);
                    setMode("setup");
                  }}
                >
                  Create account
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
