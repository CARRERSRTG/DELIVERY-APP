import { APP_VERSIONS } from "@/lib/app-versions";

/** Small version tag shown at the bottom of every screen — recruiting's own
 * number (D-087), not deliveries'. `fixed` pins it to the bottom of the
 * viewport (used on full-screen auth pages). */
export function VersionFooter({ fixed = false }: { fixed?: boolean }) {
  return (
    <footer
      className="no-print"
      style={{
        textAlign: "center",
        padding: fixed ? "0" : "16px 12px 24px",
        fontSize: 11,
        color: "var(--gray, #8a93a2)",
        opacity: 0.75,
        letterSpacing: ".02em",
        ...(fixed ? { position: "fixed", bottom: 10, left: 0, right: 0 } as const : {}),
      }}
    >
      v{APP_VERSIONS.recruiting}
    </footer>
  );
}
