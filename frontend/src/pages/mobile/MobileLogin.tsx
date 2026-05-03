import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loginRequest, setupRequired, setupRequest } from "../../hooks/useAuth";

export default function MobileLogin() {
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
    <div className="min-h-screen flex flex-col px-5 pt-16 pb-8">
      <div className="text-center mb-8">
        <div className="text-xs font-medium text-subink uppercase tracking-widest">
          Finance Tracker
        </div>
        <h1 className="mt-2 text-2xl font-semibold">
          {mode === "setup" ? "Welcome" : "Welcome back"}
        </h1>
        <p className="text-sm text-subink mt-1">
          {mode === "setup"
            ? "Create your account to begin."
            : "Sign in to continue."}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div>
          <div className="label mb-1">{mode === "setup" ? "Email" : "Email or username"}</div>
          <input
            className="input h-12"
            type={mode === "setup" ? "email" : "text"}
            inputMode="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <div className="label mb-1">Password</div>
          <input
            className="input h-12"
            type="password"
            autoComplete={mode === "setup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </div>
        {err && <div className="text-xs text-neg">{err}</div>}
        <button className="btn-primary h-12 mt-2" disabled={loading}>
          {loading ? "…" : mode === "setup" ? "Create account" : "Sign in"}
        </button>
      </form>

      {canToggle && (
        <div className="mt-6 text-center text-sm text-subink">
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
  );
}
