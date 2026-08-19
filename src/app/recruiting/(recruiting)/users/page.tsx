"use client";

import { useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { ROLE_INFO } from "@/lib/recruiting/constants";
import { avatarColor, initials } from "@/lib/recruiting/utils";
import type { UserRole } from "@/lib/recruiting/types";

export default function UsersPage() {
  const { me, recruiters, candidates, updateUserRole, updateUserName, updateUserAvatar, deleteUser, notify } = useData();
  const { t } = usePrefs();
  const isAdmin = me?.role === "admin";

  const onPhoto = (userId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 1_500_000) { notify(t("Image too large (max ~1.5 MB)", "Imagen demasiado grande (máx ~1.5 MB)")); return; }
    const r = new FileReader();
    r.onload = (ev) => updateUserAvatar(userId, ev.target?.result as string);
    r.readAsDataURL(file);
  };

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const saveName = async (id: string) => {
    await updateUserName(id, editName);
    setEditId(null);
  };

  const [invEmail, setInvEmail] = useState("");
  const [invName, setInvName] = useState("");
  const [invRole, setInvRole] = useState<UserRole>("recruiter");
  const [inviting, setInviting] = useState(false);

  const invite = async () => {
    if (!invEmail.trim()) { notify(t("Enter an email", "Ingresa un correo")); return; }
    setInviting(true);
    try {
      const res = await fetch("/api/recruiting/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: invEmail, full_name: invName, role: invRole }),
      });
      const data = await res.json();
      if (!res.ok) { notify(data.error || t("Could not send invite", "No se pudo enviar la invitación")); return; }
      notify(t("Invite sent ✓ — they'll get a confirmation email", "Invitación enviada ✓ — recibirán un correo de confirmación"));
      setInvEmail("");
      setInvName("");
      setInvRole("recruiter");
    } catch {
      notify(t("Network error sending invite", "Error de red al enviar la invitación"));
    } finally {
      setInviting(false);
    }
  };

  const candCount = (userId: string) => candidates.filter((c) => c.assigned_recruiter === userId).length;
  const hiredCount = (userId: string) => candidates.filter((c) => c.assigned_recruiter === userId && c.status === "hired").length;

  return (
    <div>
      <div className="card">
        <h2>🛡 {t("User management", "Gestión de usuarios")}</h2>
        <div className="hint" style={{ marginTop: -6 }}>
          {t("Roles:", "Roles:")} <b>Admin</b> {t("(full access + manage users),", "(acceso total + gestiona usuarios),")} <b>{t("Office Manager", "Gerente")}</b> {t("(sees all candidates and their process),", "(ve todos los candidatos y su proceso),")} <b>{t("Recruiter", "Reclutador")}</b> {t("(registers and works candidates).", "(registra y trabaja candidatos).")}
          {!isAdmin && t(" Only admins can change roles.", " Solo los admin pueden cambiar roles.")}
        </div>
      </div>

      {!isAdmin && (
        <div className="card">
          <div className="empty">{t("You don't have permission to manage users. Ask an admin to change your role.", "No tienes permiso para gestionar usuarios. Pide a un admin que cambie tu rol.")}</div>
        </div>
      )}

      {isAdmin && (
        <div className="card">
          <h2>➕ {t("Add teammate", "Agregar compañero")}</h2>
          <div className="hint" style={{ marginTop: -6 }}>
            {t("Sends an invite email. The person clicks the link, sets their own password, and confirms — then they appear in the team below with the role you picked.", "Envía un correo de invitación. La persona hace clic, pone su contraseña y confirma — luego aparece en el equipo con el rol que elegiste.")}
          </div>
          <div className="grid g3" style={{ marginTop: 12 }}>
            <div>
              <label>Email *</label>
              <input type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="person@email.com" />
            </div>
            <div>
              <label>{t("Full name", "Nombre completo")}</label>
              <input value={invName} onChange={(e) => setInvName(e.target.value)} placeholder="Jane Doe" />
            </div>
            <div>
              <label>{t("Role", "Rol")}</label>
              <select value={invRole} onChange={(e) => setInvRole(e.target.value as UserRole)}>
                <option value="recruiter">Recruiter</option>
                <option value="manager">Office Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={invite} disabled={inviting}>
              {inviting ? t("Sending…", "Enviando…") : t("Send invite", "Enviar invitación")}
            </button>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="card">
          <h2>👥 {t("Team", "Equipo")} ({recruiters.length})</h2>
          {recruiters.map((u) => {
            const info = ROLE_INFO[u.role];
            const isMe = u.id === me?.id;
            return (
              <div key={u.id} className="cand-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    {u.avatar_url ? (
                      <div className="avatar" style={{ backgroundImage: `url(${u.avatar_url})` }} />
                    ) : (
                      <div className="avatar" style={{ background: avatarColor(u.full_name || "?") }}>{initials(u.full_name || "?")}</div>
                    )}
                    <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 2 }}>
                      <label className="btn btn-sm" style={{ cursor: "pointer", margin: 0, padding: "1px 5px", fontSize: 10, color: "var(--gray)" }}>
                        {u.avatar_url ? t("Change", "Cambiar") : t("Photo", "Foto")}
                        <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onPhoto(u.id, e)} />
                      </label>
                      {u.avatar_url && (
                        <button className="btn btn-sm" style={{ padding: "1px 5px", fontSize: 10, color: "var(--gray)" }} onClick={() => updateUserAvatar(u.id, null)}>✕</button>
                      )}
                    </div>
                  </div>
                <div>
                  <div className="cand-name">
                    {editId === u.id ? (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <input
                          value={editName}
                          autoFocus
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveName(u.id); if (e.key === "Escape") setEditId(null); }}
                          style={{ width: 180, padding: "4px 8px", fontSize: 14 }}
                        />
                        <button className="btn btn-primary btn-sm" onClick={() => saveName(u.id)}>{t("Save", "Guardar")}</button>
                        <button className="btn btn-sm" style={{ color: "var(--gray)" }} onClick={() => setEditId(null)}>{t("Cancel", "Cancelar")}</button>
                      </span>
                    ) : (
                      <>
                        {u.full_name} {isMe && <span style={{ color: "var(--gray)", fontWeight: 400, fontSize: 12 }}>({t("you", "tú")})</span>}
                        <button
                          className="btn btn-sm"
                          title={t("Edit name", "Editar nombre")}
                          style={{ marginLeft: 6, color: "var(--gray)" }}
                          onClick={() => { setEditId(u.id); setEditName(u.full_name || ""); }}
                        >✏️</button>
                        <span className="sema" style={{ marginLeft: 8, background: info.color + "22", color: info.color }}>● {info.label}</span>
                      </>
                    )}
                  </div>
                  <div className="cand-meta">
                    <span>💼 {candCount(u.id)} {t("candidates", "candidatos")}</span>
                    <span style={{ color: "var(--green)" }}>✅ {hiredCount(u.id)} {t("hired", "contratados")}</span>
                    <span style={{ color: "var(--gray)" }}>{info.desc}</span>
                  </div>
                </div>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
                  <div>
                    <label style={{ marginBottom: 2 }}>{t("Role", "Rol")}</label>
                    <select
                      value={u.role}
                      style={{ width: "auto", padding: "6px 10px", fontSize: 13 }}
                      onChange={(e) => {
                        const nr = e.target.value as UserRole;
                        if (isMe && u.role === "admin" && nr !== "admin") {
                          if (!confirm(t("You are about to remove your OWN admin access. Continue?", "Estás por quitarte tu PROPIO acceso admin. ¿Continuar?"))) return;
                        }
                        updateUserRole(u.id, nr);
                      }}
                    >
                      <option value="admin">Admin</option>
                      <option value="manager">{t("Office Manager", "Gerente")}</option>
                      <option value="recruiter">{t("Recruiter", "Reclutador")}</option>
                    </select>
                  </div>
                  {!isMe && (
                    <button
                      className="btn btn-sm"
                      style={{ color: "var(--red, #dc2626)", border: "1px solid var(--red, #dc2626)" }}
                      onClick={() => {
                        if (confirm(t(`Remove ${u.full_name}'s recruiting access? They keep signing in to the rest of the app if they had access elsewhere — this only revokes recruiting. Their candidates stay assigned to them.`, `¿Quitar el acceso a recruiting de ${u.full_name}? Sigue iniciando sesión en el resto de la app si tenía acceso a algo más — esto solo revoca recruiting. Sus candidatos quedan asignados a su nombre.`))) {
                          deleteUser(u.id);
                        }
                      }}
                    >🚫 {t("Remove access", "Quitar acceso")}</button>
                  )}
                </div>
              </div>
            );
          })}
          <div className="hint">
            {t("Invited users show up here after they confirm their email. You can change anyone's role at any time.", "Los usuarios invitados aparecen aquí después de confirmar su correo. Puedes cambiar el rol de cualquiera cuando quieras.")}
          </div>
        </div>
      )}
    </div>
  );
}
