"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const supabase = createClient();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setMsg("");
    if (password.length < 6) { setMsg("Password must be at least 6 characters."); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { setMsg(error.message); return; }
    setMsg("Password updated. Redirecting…");
    setTimeout(() => router.push("/"), 1200);
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Set a new password</h1>
        <div style={{ margin: "16px 0" }}>
          <label>New password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="••••••••"
          />
        </div>
        <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={submit} disabled={loading}>
          {loading ? "..." : "Update password"}
        </button>
        {msg && <div className="hint" style={{ marginTop: 12, color: msg.includes("updated") ? "var(--green)" : "var(--red)" }}>{msg}</div>}
      </div>
    </div>
  );
}
