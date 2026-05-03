import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loginRequest, setupRequired, setupRequest, signupRequest } from "../../hooks/useAuth";

export default function MobileLogin() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [firstUser, setFirstUser] = useState<boolean>(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setupRequired()
      .then((req) => {
        setFirstUser(req);
        if (req) setMode("signup");
      })
      .catch(() => setFirstUser(false));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        if (firstUser) await setupRequest(email, password);
        else await signupRequest(email, password);
      } else {
        await loginRequest(email, password);
      }
      nav("/");
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col px-5 pt-16 pb-8">
      <div className="text-center mb-8">
        <div className="text-xs font-medium text-subink uppercase tracking-widest">
          Finance Tracker
        </div>
        <h1 className="mt-2 text-2xl font-semibold">
          {mode === "signup"
            ? firstUser
              ? "Welcome"
              : "Create account"
            : "Welcome back"}
        </h1>
        <p className="text-sm text-subink mt-1">
          {mode === "signup"
            ? firstUser
              ? "Create the first account to begin."
              : "Sign up to start tracking."
            : "Sign in to continue."}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div>
          <div className="label mb-1">{mode === "signup" ? "Email" : "Email or username"}</div>
          <input
            className="input h-12"
            type={mode === "signup" ? "email" : "text"}
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
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </div>
        {err && <div className="text-xs text-neg">{err}</div>}
        <button className="btn-primary h-12 mt-2" disabled={loading}>
          {loading ? "…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-subink">
        {mode === "signup" ? (
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
            New here?{" "}
            <button
              type="button"
              className="text-brand-accent hover:underline font-medium"
              onClick={() => {
                setErr(null);
                setMode("signup");
              }}
            >
              Create account
            </button>
          </>
        )}
      </div>
    </div>
  );
}
