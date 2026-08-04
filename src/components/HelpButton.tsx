"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { APP_VERSION, DEFAULT_HELP_EMAIL, roleLabel } from "@/lib/constants";
import { telClean } from "@/lib/utils";
import type { Profile } from "@/lib/types";

/** Floating "Help" button, mounted app-wide. Any user can tap it to email a
 * question to the support address an admin sets in Settings (help_email,
 * default DEFAULT_HELP_EMAIL). We attach who/where/version context so the
 * recipient can act without a back-and-forth. Delivery goes through /api/help
 * (Resend); until email is configured it reports a dry-run and we say so. */
export function HelpButton({ me }: { me: Profile }) {
  const { settings, notify } = useData();
  const { lang, t } = usePrefs();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const to = settings.help_email?.trim() || DEFAULT_HELP_EMAIL;

  const close = () => { if (!busy) { setOpen(false); setMsg(""); } };

  const send = async () => {
    const message = msg.trim();
    if (!message) return;
    setBusy(true);
    try {
      const res = await fetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          to,
          page: pathname,
          senderName: me.full_name,
          role: roleLabel(me.role, lang),
          appVersion: APP_VERSION,
          lang,
        }),
      });
      const b = await res.json().catch(() => ({}));
      if (b.ok) {
        notify(t("Help request sent — we'll get back to you.", "Solicitud de ayuda enviada — le responderemos."));
        setOpen(false);
        setMsg("");
      } else if (b.dryRun) {
        // Email provider not live yet: don't pretend it was delivered.
        notify(t(
          "Email isn't set up yet, so your request wasn't delivered. Ask an admin to finish email setup.",
          "El correo aún no está configurado, así que su solicitud no se envió. Pida a un administrador que termine la configuración.",
        ));
        setOpen(false);
        setMsg("");
      } else {
        notify(t("Couldn't send — please try again.", "No se pudo enviar — intente de nuevo."));
      }
    } catch {
      notify(t("Network error — please try again.", "Error de red — intente de nuevo."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className="help-fab no-print"
        onClick={() => setOpen(true)}
        title={t("Need help?", "¿Necesita ayuda?")}
        aria-label={t("Need help?", "¿Necesita ayuda?")}
      >
        <span aria-hidden>?</span>
        <span className="help-fab-label">{t("Help", "Ayuda")}</span>
      </button>

      {open && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <h3 style={{ margin: "0 0 4px" }}>{t("Need help?", "¿Necesita ayuda?")}</h3>
            <p className="hint" style={{ marginTop: 0 }}>
              {t(
                "Describe what's happening and we'll email support. We'll include your name, role, and the page you're on.",
                "Describa lo que sucede y enviaremos un correo a soporte. Incluiremos su nombre, rol y la página en la que está.",
              )}
            </p>
            {settings.help_phone?.trim() && (
              <a
                href={`tel:${telClean(settings.help_phone)}`}
                className="btn btn-green"
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12 }}
              >
                📞 {t("Call us", "Llámanos")} · {settings.help_phone}
              </a>
            )}
            <textarea
              rows={5}
              autoFocus
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder={t("What do you need help with?", "¿En qué necesita ayuda?")}
              style={{ width: "100%", resize: "vertical" }}
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={close} disabled={busy}>{t("Cancel", "Cancelar")}</button>
              <button className="btn btn-primary" onClick={send} disabled={busy || !msg.trim()}>
                {busy ? t("Sending…", "Enviando…") : t("Send", "Enviar")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
