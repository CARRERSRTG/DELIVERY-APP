"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { VersionFooter } from "@/components/VersionFooter";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

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
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="••••••••"
          />
        </div>

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
