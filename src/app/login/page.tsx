"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { VersionFooter } from "@/components/VersionFooter";

const REMEMBERED_EMAIL_KEY = "rtg_remembered_email";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // Prefill the last-remembered email so returning users don't retype it.
  useEffect(() => {
    const saved = localStorage.getItem(REMEMBERED_EMAIL_KEY);
    if (saved) setEmail(saved);
    else setRemember(false);
  }, []);

  const forgot = async () => {
    setMsg("");
    if (!email) { setMsg("Enter your email first, then click 'Forgot password'."); return; }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    setMsg(error ? error.message : "Check your email for a password-reset link.");
  };

  const submit = async () => {
    setMsg("");
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name || email.split("@")[0] } },
        });
        if (error) throw error;
        setMsg("Account created. Check your email if confirmation is required, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (remember) localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
        else localStorage.removeItem(REMEMBERED_EMAIL_KEY);
        router.refresh();
        router.push("/");
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>
          RDZ<span>·DELIVERIES</span>
        </h1>
        <p style={{ color: "var(--gray)", marginBottom: 20, fontSize: 13 }}>
          {mode === "signin" ? "Sign in to the deliveries workspace" : "Create your account"}
        </p>

        {mode === "signup" && (
          <div style={{ marginBottom: 12 }}>
            <label>Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label>Password</label>
          <div style={{ position: "relative" }}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="••••••••"
              style={{ paddingRight: 40 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              title={showPassword ? "Hide password" : "Show password"}
              style={{
                position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
                width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: 6, color: "var(--gray)", fontSize: 15,
              }}
            >
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>
        </div>

        {mode === "signin" && (
          <label style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 16, textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "var(--text)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ width: 15, height: 15 }}
            />
            Remember me
          </label>
        )}

        <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={submit} disabled={loading}>
          {loading ? "..." : mode === "signin" ? "Sign in" : "Sign up"}
        </button>

        {mode === "signin" && (
          <div style={{ marginTop: 10, textAlign: "right" }}>
            <button className="link-tel" style={{ background: "none", fontSize: 12.5 }} onClick={forgot} disabled={loading}>
              Forgot password?
            </button>
          </div>
        )}

        {msg && <div className="hint" style={{ marginTop: 12, color: msg.includes("Check your email") || msg.includes("created") ? "var(--green)" : "var(--red)" }}>{msg}</div>}

        <div style={{ marginTop: 16, textAlign: "center", fontSize: 13 }}>
          {mode === "signin" ? (
            <button className="link-tel" style={{ background: "none" }} onClick={() => setMode("signup")}>
              No account? Create one
            </button>
          ) : (
            <button className="link-tel" style={{ background: "none" }} onClick={() => setMode("signin")}>
              Already have an account? Sign in
            </button>
          )}
        </div>
      </div>
      <VersionFooter fixed />
    </div>
  );
}
